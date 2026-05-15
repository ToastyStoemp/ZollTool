using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using myPOS;

namespace ZollBridge
{
    // ── Payment result ─────────────────────────────────────────────────────────
    class PaymentOutcome
    {
        public bool   Approved  { get; set; }
        public string Status    { get; set; } = "";
        public string AuthCode  { get; set; } = "";
        public string CardBrand { get; set; } = "";
        public string Error     { get; set; } = "";
    }

    // ── Provider interface ─────────────────────────────────────────────────────
    interface IPaymentProvider
    {
        string Name { get; }
        void   Initialize();
        Task<PaymentOutcome> PayAsync(double amount, string currency, string reference, CancellationToken ct);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // myPOS provider — USB COM port, event-based SDK, auto-reconnect on unplug
    // ══════════════════════════════════════════════════════════════════════════
    class MyPosProvider : IPaymentProvider
    {
        readonly myPOSTerminal _terminal = new myPOSTerminal();
        readonly string _comPort;
        TaskCompletionSource<PaymentOutcome>? _tcs;
        bool _terminalReady  = false;
        bool _eventsAttached = false;

        public string Name => "myPOS";

        // Bridge sets this to broadcast status changes to ZollTool / remotes
        public Action<object>? OnStatusChange;

        public MyPosProvider(string comPort) => _comPort = comPort;

        bool ComPortPresent() => Array.Exists(
            SerialPort.GetPortNames(),
            p => string.Equals(p, _comPort, StringComparison.OrdinalIgnoreCase));

        public void Initialize()
        {
            if (!_eventsAttached)
            {
                _terminal.ProcessingFinished += OnResult;
                _terminal.onInnerException   += OnInnerException;
                _eventsAttached = true;
            }
            _terminal.SetLanguage(Language.English);
            _terminal.SetReceiptMode(ReceiptMode.MerchantOnly);
            _terminal.Initialize(_comPort);
            _terminalReady = true;
            Console.WriteLine($"[myPOS]    Connected on {_comPort}");
            _ = WatchComPortAsync();
        }

        async Task WatchComPortAsync()
        {
            while (true)
            {
                await Task.Delay(3000).ConfigureAwait(false);

                if (_terminalReady && !ComPortPresent())
                {
                    _terminalReady = false;
                    Console.WriteLine($"[myPOS]    {_comPort} unplugged — waiting for reconnect...");
                    _tcs?.TrySetResult(new PaymentOutcome
                    {
                        Approved = false, Status = "DISCONNECTED", Error = "Terminal unplugged",
                    });
                    OnStatusChange?.Invoke(new { status = "terminal_disconnected", provider = Name });
                }
                else if (!_terminalReady && ComPortPresent())
                {
                    Console.WriteLine($"[myPOS]    {_comPort} detected — reconnecting...");
                    try
                    {
                        try { _terminal.Disconnect(); } catch { }
                        _terminal.Initialize(_comPort);
                        _terminalReady = true;
                        Console.WriteLine($"[myPOS]    Reconnected on {_comPort}");
                        OnStatusChange?.Invoke(new { status = "terminal_reconnected", provider = Name });
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[myPOS]    Reconnect failed: {ex.Message}");
                    }
                }
            }
        }

        public Task<PaymentOutcome> PayAsync(double amount, string currency, string reference, CancellationToken ct)
        {
            if (!_terminalReady)
                return Task.FromResult(new PaymentOutcome
                {
                    Approved = false, Status = "DISCONNECTED",
                    Error    = "Terminal not connected — check the USB cable",
                });

            _tcs = new TaskCompletionSource<PaymentOutcome>();
            ct.Register(() => _tcs.TrySetCanceled());

            var cur = currency.ToUpperInvariant() switch
            {
                "CHF" => Currencies.CHF, "GBP" => Currencies.GBP,
                "USD" => Currencies.USD, "NOK" => Currencies.NOK,
                "SEK" => Currencies.SEK, "DKK" => Currencies.DKK,
                "PLN" => Currencies.PLN, _     => Currencies.EUR,
            };

            _terminal.Purchase(amount, tip: 0.0, cur,
                ReferenceNumberType.ReferenceNumber, reference, operator_code: "");

            return _tcs.Task;
        }

        void OnResult(ProcessingResult r)
        {
            if (r.CommunicationStatus == ResultCommunication.Error ||
                r.CommunicationStatus == ResultCommunication.Timeout)
            {
                _terminalReady = false;
                OnStatusChange?.Invoke(new { status = "terminal_disconnected", provider = Name });
                Console.WriteLine($"[myPOS]    Communication error ({r.CommunicationStatus}) — marking offline");
            }

            bool approved = r.Status == TransactionStatus.Success
                         || r.Status == TransactionStatus.SuccessWithInfo;
            var d = r.TranData;
            _tcs?.TrySetResult(new PaymentOutcome
            {
                Approved  = approved,
                Status    = r.Status.ToString(),
                AuthCode  = d?.AuthCode ?? "",
                CardBrand = d?.AIDName  ?? "",
            });
        }

        void OnInnerException(Exception ex)
        {
            Console.WriteLine($"[myPOS]    Internal exception: {ex.Message}");
            if (_terminalReady)
            {
                _terminalReady = false;
                _tcs?.TrySetResult(new PaymentOutcome
                {
                    Approved = false, Status = "ERROR", Error = ex.Message,
                });
                OnStatusChange?.Invoke(new { status = "terminal_disconnected", provider = Name });
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SumUp provider — Cloud REST API, polling for result
    // ══════════════════════════════════════════════════════════════════════════
    class SumUpProvider : IPaymentProvider
    {
        readonly string _merchantCode;
        readonly string _readerId;
        readonly HttpClient _http;

        public string Name => "SumUp";

        public SumUpProvider(string apiKey, string merchantCode, string readerId)
        {
            _merchantCode = merchantCode;
            _readerId     = readerId;
            _http = new HttpClient { BaseAddress = new Uri("https://api.sumup.com") };
            _http.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
        }

        public void Initialize()
        {
            Console.WriteLine($"[SumUp]    Ready (merchant={_merchantCode} reader={_readerId})");
        }

        public async Task<PaymentOutcome> PayAsync(double amount, string currency, string reference, CancellationToken ct)
        {
            int minorUnit = currency.ToUpperInvariant() == "JPY" ? 0 : 2;
            int value     = (int)Math.Round(amount * Math.Pow(10, minorUnit));

            var body = new JObject
            {
                ["total_amount"] = new JObject
                {
                    ["currency"]   = currency.ToUpperInvariant(),
                    ["minor_unit"] = minorUnit,
                    ["value"]      = value,
                }
            };

            Console.WriteLine($"[SumUp]    POST checkout {amount:F2} {currency}");
            HttpResponseMessage resp;
            try
            {
                resp = await _http.PostAsync(
                    $"/v0.1/merchants/{_merchantCode}/readers/{_readerId}/checkout",
                    new StringContent(body.ToString(), Encoding.UTF8, "application/json"), ct);
            }
            catch (Exception ex)
            {
                return new PaymentOutcome { Approved = false, Status = "ERROR", Error = ex.Message };
            }

            var respStr = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                Console.WriteLine($"[SumUp]    Checkout rejected: {(int)resp.StatusCode} {respStr}");
                return new PaymentOutcome { Approved = false, Status = $"HTTP_{(int)resp.StatusCode}", Error = respStr };
            }

            var respJson   = JObject.Parse(respStr);
            var checkoutId = respJson["id"]?.Value<string>();
            if (string.IsNullOrEmpty(checkoutId))
            {
                Console.WriteLine($"[SumUp]    No checkout ID in response: {respStr}");
                return new PaymentOutcome { Approved = false, Status = "ERROR", Error = "No checkout ID returned" };
            }

            Console.WriteLine($"[SumUp]    Checkout id={checkoutId} — polling...");

            for (int i = 0; i < 60; i++)
            {
                if (ct.IsCancellationRequested) break;
                await Task.Delay(2000, ct).ConfigureAwait(false);

                try
                {
                    var poll    = await _http.GetAsync($"/v0.1/checkouts/{checkoutId}", ct);
                    var pollStr = await poll.Content.ReadAsStringAsync();
                    var pollObj = JObject.Parse(pollStr);
                    var status  = pollObj["status"]?.Value<string>()?.ToUpperInvariant();

                    Console.WriteLine($"[SumUp]    [{i+1}/60] status={status}");

                    if (status == "SUCCESSFUL")
                    {
                        var tx = pollObj["transactions"]?.First;
                        return new PaymentOutcome
                        {
                            Approved  = true, Status = "SUCCESSFUL",
                            AuthCode  = tx?["auth_code"]?.Value<string>() ?? "",
                            CardBrand = tx?["card"]?["type"]?.Value<string>() ?? "",
                        };
                    }
                    if (status is "FAILED" or "CANCELLED")
                        return new PaymentOutcome { Approved = false, Status = status };
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { Console.WriteLine($"[SumUp]    Poll error: {ex.Message}"); }
            }

            return new PaymentOutcome
            {
                Approved = false, Status = "TIMEOUT",
                Error    = "No result from terminal within 2 minutes",
            };
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WebSocket connection wrapper — stream + per-connection send lock
    // ══════════════════════════════════════════════════════════════════════════
    sealed class WsConn
    {
        public readonly Stream        Stream;
        public readonly SemaphoreSlim Lock = new SemaphoreSlim(1, 1);
        public          string        Id   = Guid.NewGuid().ToString("N").Substring(0, 8);
        public          string        Role = "";   // "primary" | "remote"
        public          string        Name = "";

        public WsConn(Stream s) => Stream = s;

        public Task SendAsync(object obj) =>
            SendTextAsync(JsonConvert.SerializeObject(obj));

        public Task SendTextAsync(string text) =>
            SendRawAsync(0x1, Encoding.UTF8.GetBytes(text));

        public async Task SendRawAsync(byte opcode, byte[] data)
        {
            int    len = data.Length;
            byte[] frame;

            if (len < 126)
            {
                frame    = new byte[2 + len];
                frame[0] = (byte)(0x80 | opcode);
                frame[1] = (byte)len;
                Buffer.BlockCopy(data, 0, frame, 2, len);
            }
            else if (len < 65536)
            {
                frame    = new byte[4 + len];
                frame[0] = (byte)(0x80 | opcode);
                frame[1] = 126;
                frame[2] = (byte)(len >> 8);
                frame[3] = (byte)len;
                Buffer.BlockCopy(data, 0, frame, 4, len);
            }
            else
            {
                frame    = new byte[10 + len];
                frame[0] = (byte)(0x80 | opcode);
                frame[1] = 127;
                for (int i = 0; i < 8; i++)
                    frame[2 + i] = (byte)((long)len >> (56 - 8 * i));
                Buffer.BlockCopy(data, 0, frame, 10, len);
            }

            await Lock.WaitAsync().ConfigureAwait(false);
            try   { await Stream.WriteAsync(frame, 0, frame.Length).ConfigureAwait(false); }
            finally { Lock.Release(); }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Bridge — WSS on localhost:8765 (pos.html) + plain WS on *:8766 (remotes)
    // ══════════════════════════════════════════════════════════════════════════
    class Program
    {
        // ── Shared state ───────────────────────────────────────────────────────
        static IPaymentProvider? _provider;

        static volatile WsConn?  _primary;   // pos.html running on the PC
        static readonly Dictionary<string, WsConn> _remotes     = new Dictionary<string, WsConn>();
        static readonly object                      _remotesLock = new object();
        static volatile string? _cachedCatalog;   // last catalog JSON from primary

        static int _wsPort  = 8765;  // TLS WSS for pos.html (localhost)
        static int _lanPort = 8766;  // plain WS/HTTP for remote devices (LAN)

        // ── Certificate ────────────────────────────────────────────────────────
        static X509Certificate2 LoadOrCreateCert()
        {
            const string PfxPath = "bridge-cert.pfx";
            const string PfxPass = "zollbridge";

            if (File.Exists(PfxPath))
            {
                try { return new X509Certificate2(PfxPath, PfxPass); }
                catch { Console.WriteLine("[cert]     Existing cert unreadable — regenerating."); }
            }

            Console.WriteLine("[cert]     Generating self-signed TLS certificate...");

            using var rsa = RSA.Create(2048);
            var req = new CertificateRequest(
                "CN=ZollBridge", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

            req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
            req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, false));
            req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
                new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));

            var san = new SubjectAlternativeNameBuilder();
            san.AddDnsName("localhost");
            san.AddIpAddress(IPAddress.Loopback);
            req.CertificateExtensions.Add(san.Build());

            var cert    = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(10));
            var pfxData = cert.Export(X509ContentType.Pfx, PfxPass);
            File.WriteAllBytes(PfxPath, pfxData);
            File.WriteAllBytes("bridge-cert.crt", cert.Export(X509ContentType.Cert));

            // Store in CurrentUser\My so Schannel can find the private key
            using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            store.Add(new X509Certificate2(pfxData, PfxPass,
                X509KeyStorageFlags.UserKeySet | X509KeyStorageFlags.PersistKeySet | X509KeyStorageFlags.Exportable));
            store.Close();

            Console.WriteLine("[cert]     Created bridge-cert.pfx + bridge-cert.crt");
            Console.WriteLine("[cert]");
            Console.WriteLine("[cert]     *** ONE-TIME BROWSER TRUST STEP ***");
            Console.WriteLine($"[cert]     1. Open Chrome and visit: https://localhost:{_wsPort}");
            Console.WriteLine("[cert]     2. Click 'Advanced' → 'Proceed to localhost (unsafe)'");
            Console.WriteLine("[cert]     3. Done — the indicator in ZollTool will turn green.");
            Console.WriteLine("[cert]");
            Console.WriteLine("[cert]     OR install permanently: double-click bridge-cert.crt");
            Console.WriteLine("[cert]     → Install Certificate → Local Machine → Trusted Root CAs");
            Console.WriteLine("[cert]");

            return new X509Certificate2(pfxData, PfxPass, X509KeyStorageFlags.UserKeySet);
        }

        // ── Entry point ────────────────────────────────────────────────────────
        static async Task Main(string[] args)
        {
            string comPort      = "COM3";
            string providerName = "mypos";
            string? sumupKey = null, sumupMerchant = null, sumupReader = null;

            if (File.Exists("config.json"))
            {
                try
                {
                    var cfg  = JObject.Parse(File.ReadAllText("config.json"));
                    comPort      = cfg["comPort"]?.Value<string>()  ?? comPort;
                    _wsPort      = cfg["wsPort"]?.Value<int>()      ?? _wsPort;
                    _lanPort     = cfg["lanPort"]?.Value<int>()     ?? _lanPort;
                    providerName = cfg["provider"]?.Value<string>() ?? providerName;
                    var su   = cfg["sumup"];
                    if (su != null)
                    {
                        sumupKey      = su["apiKey"]?.Value<string>();
                        sumupMerchant = su["merchantCode"]?.Value<string>();
                        sumupReader   = su["readerId"]?.Value<string>();
                    }
                }
                catch { Console.WriteLine("[config]   Could not parse config.json — using defaults."); }
            }

            if (args.Length >= 1) providerName = args[0];
            if (args.Length >= 2) comPort      = args[1];

            // ── Init provider ──────────────────────────────────────────────
            try
            {
                if (providerName.ToLowerInvariant() == "sumup")
                {
                    if (string.IsNullOrEmpty(sumupKey) || string.IsNullOrEmpty(sumupMerchant) || string.IsNullOrEmpty(sumupReader))
                    {
                        Console.WriteLine("[SumUp]    ERROR: config.json must have sumup.apiKey, merchantCode, readerId");
                        Console.ReadLine(); return;
                    }
                    _provider = new SumUpProvider(sumupKey!, sumupMerchant!, sumupReader!);
                }
                else
                {
                    _provider = new MyPosProvider(comPort);
                }
                _provider.Initialize();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[init]     ERROR: {ex.Message}");
                Console.WriteLine("           Press Enter to exit.");
                Console.ReadLine(); return;
            }

            // ── TLS certificate (WSS port only) ────────────────────────────
            X509Certificate2 cert;
            try { cert = LoadOrCreateCert(); }
            catch (Exception ex)
            {
                Console.WriteLine($"[cert]     ERROR: {ex.Message}");
                Console.ReadLine(); return;
            }

            // ── Start both listeners ───────────────────────────────────────
            var tlsListener = new TcpListener(IPAddress.Loopback, _wsPort);
            tlsListener.Start();

            var lanListener = new TcpListener(IPAddress.Any, _lanPort);
            lanListener.Start();

            var lanIp = GetLanIp();
            Console.WriteLine($"\n[bridge]   {_provider.Name} ready");
            Console.WriteLine($"           WSS  (pos.html):  wss://localhost:{_wsPort}");
            Console.WriteLine($"           LAN  (remotes):   http://{lanIp}:{_lanPort}");
            Console.WriteLine("           Open ZollTool POS; indicator (💳) will turn green.");
            Console.WriteLine("           Remote devices: open the LAN URL in a mobile browser.");
            Console.WriteLine("           Press Ctrl+C to stop.\n");

            _ = AcceptTlsClients(tlsListener, cert);
            await AcceptLanClients(lanListener).ConfigureAwait(false);
        }

        static string GetLanIp()
        {
            try
            {
                return NetworkInterface.GetAllNetworkInterfaces()
                    .Where(i => i.OperationalStatus == OperationalStatus.Up
                             && i.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .SelectMany(i => i.GetIPProperties().UnicastAddresses)
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                    .Select(a => a.Address.ToString())
                    .FirstOrDefault() ?? "YOUR_PC_IP";
            }
            catch { return "YOUR_PC_IP"; }
        }

        // ── Accept loops ───────────────────────────────────────────────────────
        static async Task AcceptTlsClients(TcpListener listener, X509Certificate2 cert)
        {
            while (true)
            {
                TcpClient client;
                try { client = await listener.AcceptTcpClientAsync().ConfigureAwait(false); }
                catch { break; }
                _ = HandleTlsTcpClient(client, cert);
            }
        }

        static async Task AcceptLanClients(TcpListener listener)
        {
            while (true)
            {
                TcpClient client;
                try { client = await listener.AcceptTcpClientAsync().ConfigureAwait(false); }
                catch { break; }
                _ = HandlePlainTcpClient(client);
            }
        }

        // ── TLS connection (pos.html on localhost) ─────────────────────────────
        static async Task HandleTlsTcpClient(TcpClient tcp, X509Certificate2 cert)
        {
            SslStream? ssl = null;
            try
            {
                ssl = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
                try
                {
                    await ssl.AuthenticateAsServerAsync(
                        cert, clientCertificateRequired: false,
                        enabledSslProtocols: System.Security.Authentication.SslProtocols.None,
                        checkCertificateRevocation: false).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("[bridge]   TLS handshake failed — browser may not trust the cert yet.");
                    Console.WriteLine($"           Visit https://localhost:{_wsPort} → Advanced → Proceed.");
                    Console.WriteLine($"           Detail: {ex.Message}");
                    return;
                }

                var headers = await ReadHttpHeaders(ssl).ConfigureAwait(false);
                if (headers == null) return;

                var method = headers.TryGetValue(":method", out var m) ? m : "GET";
                bool isWs  = headers.TryGetValue("upgrade", out var upHdr)
                          && upHdr.Equals("websocket", StringComparison.OrdinalIgnoreCase);

                // OPTIONS preflight (Chrome Private Network Access)
                if (method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    var origin = headers.TryGetValue("origin", out var o) ? o : "*";
                    var pre    = $"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: {origin}\r\n" +
                                 $"Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\n" +
                                 $"Access-Control-Allow-Private-Network: true\r\nContent-Length: 0\r\n\r\n";
                    var prb = Encoding.ASCII.GetBytes(pre);
                    await ssl.WriteAsync(prb, 0, prb.Length).ConfigureAwait(false);
                    return;
                }

                if (!isWs)
                {
                    // Cert-trust landing page
                    var body = Encoding.UTF8.GetBytes(
                        $"{{\"bridge\":\"ZollBridge\",\"provider\":\"{_provider?.Name ?? "none"}\"," +
                        $"\"status\":\"ready\",\"note\":\"Certificate trusted — ZollTool will connect automatically.\"}}");
                    var resp = $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                               $"Content-Length: {body.Length}\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
                    var rb = Encoding.ASCII.GetBytes(resp);
                    await ssl.WriteAsync(rb, 0, rb.Length).ConfigureAwait(false);
                    await ssl.WriteAsync(body, 0, body.Length).ConfigureAwait(false);
                    Console.WriteLine("[bridge]   Certificate trust page served.");
                    return;
                }

                // WebSocket upgrade
                if (!headers.TryGetValue("sec-websocket-key", out var wsKey)) return;
                var accept  = ComputeWsAccept(wsKey);
                var origin2 = headers.TryGetValue("origin", out var o2) ? o2 : "*";
                var shake   = $"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                              $"Sec-WebSocket-Accept: {accept}\r\n" +
                              $"Access-Control-Allow-Private-Network: true\r\n" +
                              $"Access-Control-Allow-Origin: {origin2}\r\n\r\n";
                var sb = Encoding.ASCII.GetBytes(shake);
                await ssl.WriteAsync(sb, 0, sb.Length).ConfigureAwait(false);

                await HandleWsSession(new WsConn(ssl)).ConfigureAwait(false);
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   TLS error: {ex.Message}"); }
            finally { ssl?.Close(); tcp.Close(); }
        }

        // ── Plain connection (remote devices on LAN) ───────────────────────────
        static async Task HandlePlainTcpClient(TcpClient tcp)
        {
            var stream = tcp.GetStream();
            try
            {
                var headers = await ReadHttpHeaders(stream).ConfigureAwait(false);
                if (headers == null) return;

                bool isWs = headers.TryGetValue("upgrade", out var upHdr)
                         && upHdr.Equals("websocket", StringComparison.OrdinalIgnoreCase);

                if (isWs)
                {
                    if (!headers.TryGetValue("sec-websocket-key", out var wsKey)) return;
                    var accept = ComputeWsAccept(wsKey);
                    var origin = headers.TryGetValue("origin", out var o) ? o : "*";
                    var shake  = $"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                                 $"Sec-WebSocket-Accept: {accept}\r\nAccess-Control-Allow-Origin: {origin}\r\n\r\n";
                    var sb = Encoding.ASCII.GetBytes(shake);
                    await stream.WriteAsync(sb, 0, sb.Length).ConfigureAwait(false);

                    await HandleWsSession(new WsConn(stream)).ConfigureAwait(false);
                }
                else
                {
                    await ServeRemoteHtml(stream, headers).ConfigureAwait(false);
                }
            }
            catch (Exception ex) { Console.WriteLine($"[lan]      Connection error: {ex.Message}"); }
            finally { tcp.Close(); }
        }

        // ── Serve remote.html over plain HTTP ──────────────────────────────────
        static async Task ServeRemoteHtml(Stream stream, Dictionary<string, string> headers)
        {
            // Search for remote.html relative to exe, then project root (dev), then cwd
            var searchPaths = new[]
            {
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "remote.html"),
                Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "remote.html")),
                Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "remote.html")),
                Path.Combine(Directory.GetCurrentDirectory(), "remote.html"),
            };

            var htmlPath = searchPaths.FirstOrDefault(File.Exists);
            string html  = htmlPath != null
                ? File.ReadAllText(htmlPath)
                : "<html><body style='font-family:sans-serif;padding:2rem'>" +
                  "<h2>remote.html not found</h2>" +
                  "<p>Place <code>remote.html</code> next to <code>ZollBridge.exe</code> and restart the bridge.</p>" +
                  "</body></html>";

            var body   = Encoding.UTF8.GetBytes(html);
            var origin = headers.TryGetValue("origin", out var o) ? o : "*";
            var resp   = $"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
                         $"Content-Length: {body.Length}\r\nCache-Control: no-cache\r\n" +
                         $"Access-Control-Allow-Origin: {origin}\r\n\r\n";
            var rb = Encoding.ASCII.GetBytes(resp);
            await stream.WriteAsync(rb, 0, rb.Length).ConfigureAwait(false);
            await stream.WriteAsync(body, 0, body.Length).ConfigureAwait(false);
        }

        // ── Identify and dispatch ──────────────────────────────────────────────
        static async Task HandleWsSession(WsConn conn)
        {
            // First message must be {action:"identify", role:"primary"|"remote", name?:"...", force?:true}
            var firstText = await WsReceive(conn).ConfigureAwait(false);
            if (firstText == null || firstText.Length == 0) return;

            JObject firstMsg;
            try { firstMsg = JObject.Parse(firstText); }
            catch { return; }

            if (firstMsg["action"]?.Value<string>() != "identify") return;

            conn.Role = firstMsg["role"]?.Value<string>() ?? "remote";
            conn.Name = firstMsg["name"]?.Value<string>() ?? "Remote";
            bool force = firstMsg["force"]?.Value<bool>() ?? false;

            if (conn.Role == "primary")
                await HandlePrimarySession(conn, force).ConfigureAwait(false);
            else
                await HandleRemoteSession(conn).ConfigureAwait(false);
        }

        // ── Primary session (pos.html) ─────────────────────────────────────────
        static async Task HandlePrimarySession(WsConn conn, bool force)
        {
            // Reject if another primary is already active, unless this is a forced takeover
            WsConn? kicked   = null;
            bool    rejected = false;

            lock (_remotesLock)
            {
                if (_primary != null && !force)
                {
                    rejected = true;
                }
                else
                {
                    kicked   = _primary;
                    _primary = conn;
                }
            }

            if (rejected)
            {
                Console.WriteLine("[bridge]   Second primary rejected (another tab already connected)");
                await conn.SendAsync(new
                {
                    status = "primary_taken",
                    error  = "Another ZollTool tab is already connected to this bridge. " +
                             "Close that tab, or click the indicator to force a takeover.",
                }).ConfigureAwait(false);
                await Task.Delay(300).ConfigureAwait(false); // let the message flush
                return;
            }

            if (kicked != null)
            {
                Console.WriteLine("[bridge]   Forced takeover — closing previous primary");
                try { kicked.Stream.Close(); } catch { }
            }

            // Wire status-change callback (myPOS only)
            if (_provider is MyPosProvider mp)
                mp.OnStatusChange = obj => { if (_primary == conn) _ = conn.SendAsync(obj); };

            Console.WriteLine("[bridge]   Primary (pos.html) connected");
            await conn.SendAsync(new { status = "connected", provider = _provider?.Name ?? "unknown" })
                      .ConfigureAwait(false);

            // Tell primary how many remotes are already waiting
            int remoteCount;
            lock (_remotesLock) { remoteCount = _remotes.Count; }
            if (remoteCount > 0)
                await conn.SendAsync(new { action = "remote_count", count = remoteCount })
                          .ConfigureAwait(false);

            // Notify waiting remotes that the primary is now online
            List<WsConn> existing;
            lock (_remotesLock) { existing = _remotes.Values.ToList(); }
            foreach (var r in existing)
                _ = r.SendAsync(new { action = "primary_online" });

            CancellationTokenSource? paymentCts = null;
            try
            {
                while (true)
                {
                    var text = await WsReceive(conn).ConfigureAwait(false);
                    if (text == null) break;
                    if (text.Length == 0) continue;

                    JObject msg;
                    try { msg = JObject.Parse(text); } catch { continue; }
                    var action = msg["action"]?.Value<string>();

                    // ── Catalog update: cache + relay to all remotes ──────────
                    if (action == "catalog")
                    {
                        _cachedCatalog = text;
                        List<WsConn> remotes;
                        lock (_remotesLock) { remotes = _remotes.Values.ToList(); }
                        foreach (var r in remotes) _ = r.SendTextAsync(text);
                        Console.WriteLine($"[bridge]   Catalog cached ({remotes.Count} remote(s) updated)");
                    }

                    // ── Order result: forward to originating remote ───────────
                    else if (action == "order_result")
                    {
                        var clientId = msg["clientId"]?.Value<string>() ?? "";
                        if (!string.IsNullOrEmpty(clientId))
                        {
                            WsConn? remote;
                            lock (_remotesLock) { _remotes.TryGetValue(clientId, out remote); }
                            if (remote != null) _ = remote.SendTextAsync(text);
                        }
                    }

                    // ── Card payment ──────────────────────────────────────────
                    else if (action == "pay" && _provider != null)
                    {
                        var amountStr = msg["amount"]?.Value<string>()    ?? "0";
                        var currency  = msg["currency"]?.Value<string>()  ?? "EUR";
                        var reference = msg["reference"]?.Value<string>() ?? Guid.NewGuid().ToString();

                        if (!double.TryParse(amountStr, NumberStyles.Any, CultureInfo.InvariantCulture, out double amount))
                        {
                            await conn.SendAsync(new { approved = false, error = "Invalid amount" }).ConfigureAwait(false);
                            continue;
                        }

                        Console.WriteLine($"[payment]  {amount:F2} {currency} via {_provider.Name}");
                        paymentCts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
                        try
                        {
                            var outcome = await _provider.PayAsync(amount, currency, reference, paymentCts.Token)
                                                         .ConfigureAwait(false);
                            Console.WriteLine($"[payment]  approved={outcome.Approved} status={outcome.Status}");
                            await conn.SendAsync(new
                            {
                                approved   = outcome.Approved,
                                status     = outcome.Status,
                                auth_code  = outcome.AuthCode,
                                card_brand = outcome.CardBrand,
                                reference,
                            }).ConfigureAwait(false);
                        }
                        catch (OperationCanceledException)
                        {
                            await conn.SendAsync(new { approved = false, error = "Payment cancelled or timed out" })
                                      .ConfigureAwait(false);
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[payment]  ERROR: {ex.Message}");
                            await conn.SendAsync(new { approved = false, error = ex.Message }).ConfigureAwait(false);
                        }
                        finally { paymentCts?.Dispose(); paymentCts = null; }
                    }

                    // ── Cancel ────────────────────────────────────────────────
                    else if (action == "cancel")
                    {
                        try { paymentCts?.Cancel(); } catch (ObjectDisposedException) { }
                        Console.WriteLine("[payment]  Cancelled by pos.html");
                    }

                    // ── Ping ──────────────────────────────────────────────────
                    else if (action == "ping")
                    {
                        await conn.SendAsync(new { status = "pong" }).ConfigureAwait(false);
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   Primary error: {ex.Message}"); }
            finally
            {
                paymentCts?.Cancel();
                if (_provider is MyPosProvider mpClear) mpClear.OnStatusChange = null;
                lock (_remotesLock) { if (_primary == conn) _primary = null; }
                Console.WriteLine("[bridge]   Primary disconnected");

                // Notify all remotes
                List<WsConn> remotes;
                lock (_remotesLock) { remotes = _remotes.Values.ToList(); }
                foreach (var r in remotes) _ = r.SendAsync(new { action = "primary_offline" });
            }
        }

        // ── Remote session (phone / tablet) ───────────────────────────────────
        static async Task HandleRemoteSession(WsConn conn)
        {
            lock (_remotesLock) { _remotes[conn.Id] = conn; }
            Console.WriteLine($"[bridge]   Remote '{conn.Name}' connected ({conn.Id})");

            // Send connection acknowledgement
            var hasPrimary = _primary != null;
            await conn.SendAsync(new { action = "connected", clientId = conn.Id, hasPrimary })
                      .ConfigureAwait(false);

            // Forward cached catalog immediately if available
            var catalog = _cachedCatalog;
            if (catalog != null) _ = conn.SendTextAsync(catalog);

            // Tell primary a new remote joined
            NotifyPrimaryRemoteCount();

            try
            {
                while (true)
                {
                    var text = await WsReceive(conn).ConfigureAwait(false);
                    if (text == null) break;
                    if (text.Length == 0) continue;

                    JObject msg;
                    try { msg = JObject.Parse(text); } catch { continue; }
                    var action = msg["action"]?.Value<string>();

                    // ── Order: add routing info, forward to primary ───────────
                    if (action == "order")
                    {
                        var primary = _primary;
                        if (primary == null)
                        {
                            await conn.SendAsync(new
                            {
                                action   = "order_result",
                                clientId = conn.Id,
                                approved = false,
                                error    = "POS is not connected",
                            }).ConfigureAwait(false);
                        }
                        else
                        {
                            msg["clientId"]   = JToken.FromObject(conn.Id);
                            msg["remoteName"] = JToken.FromObject(conn.Name);
                            msg["action"]     = JToken.FromObject("remote_order");
                            _ = primary.SendTextAsync(msg.ToString(Formatting.None));
                            Console.WriteLine($"[bridge]   Order from '{conn.Name}' forwarded to primary");
                        }
                    }

                    // ── Cart sync: forward to primary so it can mirror the cart ──
                    else if (action == "cart_sync")
                    {
                        var primary = _primary;
                        if (primary != null)
                        {
                            msg["clientId"]   = JToken.FromObject(conn.Id);
                            msg["remoteName"] = JToken.FromObject(conn.Name);
                            _ = primary.SendTextAsync(msg.ToString(Formatting.None));
                        }
                    }

                    // ── Catalog re-request ────────────────────────────────────
                    else if (action == "get_catalog")
                    {
                        var cat = _cachedCatalog;
                        if (cat != null) _ = conn.SendTextAsync(cat);
                    }

                    // ── Ping ──────────────────────────────────────────────────
                    else if (action == "ping")
                    {
                        await conn.SendAsync(new { status = "pong" }).ConfigureAwait(false);
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   Remote '{conn.Name}' error: {ex.Message}"); }
            finally
            {
                lock (_remotesLock) { _remotes.Remove(conn.Id); }
                Console.WriteLine($"[bridge]   Remote '{conn.Name}' disconnected");
                NotifyPrimaryRemoteCount();
            }
        }

        static void NotifyPrimaryRemoteCount()
        {
            var p = _primary;
            if (p == null) return;
            int count;
            lock (_remotesLock) { count = _remotes.Count; }
            _ = p.SendAsync(new { action = "remote_count", count });
        }

        // ── HTTP headers parser ────────────────────────────────────────────────
        static async Task<Dictionary<string, string>?> ReadHttpHeaders(Stream stream)
        {
            var sb  = new StringBuilder();
            var buf = new byte[1];
            while (true)
            {
                int n = await stream.ReadAsync(buf, 0, 1).ConfigureAwait(false);
                if (n == 0) return null;
                sb.Append((char)buf[0]);
                int l = sb.Length;
                if (l >= 4 && sb[l-4]=='\r' && sb[l-3]=='\n' && sb[l-2]=='\r' && sb[l-1]=='\n') break;
                if (l > 8192) return null;
            }

            var lines   = sb.ToString().Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            // Parse request line (e.g. "GET / HTTP/1.1")
            if (lines.Length > 0)
            {
                var parts = lines[0].Split(' ');
                if (parts.Length >= 2) { headers[":method"] = parts[0]; headers[":path"] = parts[1]; }
            }
            // Parse header fields
            foreach (var line in lines.Skip(1))
            {
                int i = line.IndexOf(':');
                if (i > 0) headers[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
            }
            return headers;
        }

        // ── WebSocket accept key ───────────────────────────────────────────────
        static string ComputeWsAccept(string key)
        {
            using var sha = SHA1.Create();
            return Convert.ToBase64String(
                sha.ComputeHash(Encoding.ASCII.GetBytes(key.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        }

        // ── WebSocket frame receive ────────────────────────────────────────────
        static async Task<string?> WsReceive(WsConn conn)
        {
            var stream = conn.Stream;
            try
            {
                var hdr = new byte[2];
                if (!await ReadExact(stream, hdr, 2).ConfigureAwait(false)) return null;

                int  opcode = hdr[0] & 0x0F;
                if (opcode == 0x8) return null;  // close
                bool masked = (hdr[1] & 0x80) != 0;
                long len    = hdr[1] & 0x7F;

                if (len == 126)
                {
                    var ext = new byte[2];
                    if (!await ReadExact(stream, ext, 2).ConfigureAwait(false)) return null;
                    len = (ext[0] << 8) | ext[1];
                }
                else if (len == 127)
                {
                    var ext = new byte[8];
                    if (!await ReadExact(stream, ext, 8).ConfigureAwait(false)) return null;
                    len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
                }

                var mask    = new byte[4];
                if (masked && !await ReadExact(stream, mask, 4).ConfigureAwait(false)) return null;

                var payload = new byte[len];
                if (!await ReadExact(stream, payload, (int)len).ConfigureAwait(false)) return null;
                if (masked) for (int i = 0; i < len; i++) payload[i] ^= mask[i % 4];

                // Respond to ping with pong
                if (opcode == 0x9) { _ = conn.SendRawAsync(0xA, payload); return ""; }

                return Encoding.UTF8.GetString(payload);
            }
            catch { return null; }
        }

        // ── Read exactly N bytes ───────────────────────────────────────────────
        static async Task<bool> ReadExact(Stream stream, byte[] buf, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int n = await stream.ReadAsync(buf, offset, count - offset).ConfigureAwait(false);
                if (n == 0) return false;
                offset += n;
            }
            return true;
        }
    }
}
