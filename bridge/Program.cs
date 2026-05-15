using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
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
        string Name    { get; }
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
        bool _terminalReady = false;
        bool _eventsAttached = false;

        public string Name => "myPOS";

        // Bridge sets this to broadcast status changes (disconnected/reconnected) to ZollTool
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
            _ = WatchComPortAsync();  // start background watcher
        }

        // Background task: polls the COM port list every 3 s.
        // On unplug → notifies bridge; on replug → reconnects automatically.
        async Task WatchComPortAsync()
        {
            while (true)
            {
                await Task.Delay(3000).ConfigureAwait(false);

                if (_terminalReady && !ComPortPresent())
                {
                    _terminalReady = false;
                    Console.WriteLine($"[myPOS]    {_comPort} unplugged — waiting for reconnect...");
                    // Fail any in-flight payment immediately
                    _tcs?.TrySetResult(new PaymentOutcome
                    {
                        Approved = false,
                        Status   = "DISCONNECTED",
                        Error    = "Terminal unplugged",
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
                    Approved = false,
                    Status   = "DISCONNECTED",
                    Error    = "Terminal not connected — check the USB cable",
                });

            _tcs = new TaskCompletionSource<PaymentOutcome>();
            ct.Register(() => _tcs.TrySetCanceled());

            var cur = currency.ToUpperInvariant() switch
            {
                "CHF" => Currencies.CHF,
                "GBP" => Currencies.GBP,
                "USD" => Currencies.USD,
                "NOK" => Currencies.NOK,
                "SEK" => Currencies.SEK,
                "DKK" => Currencies.DKK,
                "PLN" => Currencies.PLN,
                _     => Currencies.EUR,
            };

            _terminal.Purchase(amount, tip: 0.0, cur,
                ReferenceNumberType.ReferenceNumber, reference, operator_code: "");

            return _tcs.Task;
        }

        void OnResult(ProcessingResult r)
        {
            // Communication failure → treat as unplug even if port still shows
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

            Console.WriteLine($"[SumUp]    Checkout id={checkoutId} — polling for result...");

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
                            Approved  = true,
                            Status    = "SUCCESSFUL",
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
                Approved = false,
                Status   = "TIMEOUT",
                Error    = "No result from terminal within 2 minutes",
            };
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Bridge — WSS server (TcpListener + SslStream), routes to configured provider
    // ══════════════════════════════════════════════════════════════════════════
    class Program
    {
        static IPaymentProvider? provider;
        static Stream?           activeStream;
        static int               wsPort = 8765;

        // Serialises concurrent writes from payment result + status-change callbacks
        static readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);

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
                new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false)); // TLS server auth

            var san = new SubjectAlternativeNameBuilder();
            san.AddDnsName("localhost");
            san.AddIpAddress(IPAddress.Loopback);
            req.CertificateExtensions.Add(san.Build());

            var cert    = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(10));
            var pfxData = cert.Export(X509ContentType.Pfx, PfxPass);
            File.WriteAllBytes(PfxPath, pfxData);
            File.WriteAllBytes("bridge-cert.crt", cert.Export(X509ContentType.Cert));

            Console.WriteLine("[cert]     Created bridge-cert.pfx + bridge-cert.crt");
            Console.WriteLine("[cert]");
            Console.WriteLine("[cert]     *** ONE-TIME BROWSER TRUST STEP ***");
            Console.WriteLine($"[cert]     1. Open Chrome and visit: https://localhost:{wsPort}");
            Console.WriteLine("[cert]     2. Click 'Advanced' → 'Proceed to localhost (unsafe)'");
            Console.WriteLine("[cert]     3. Done — the indicator in ZollTool will turn green.");
            Console.WriteLine("[cert]");
            Console.WriteLine("[cert]     OR install permanently: double-click bridge-cert.crt");
            Console.WriteLine("[cert]     → Install Certificate → Local Machine → Trusted Root CAs");
            Console.WriteLine("[cert]");

            return new X509Certificate2(pfxData, PfxPass, X509KeyStorageFlags.MachineKeySet);
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
                    var cfg   = JObject.Parse(File.ReadAllText("config.json"));
                    comPort      = cfg["comPort"]?.Value<string>()  ?? comPort;
                    wsPort       = cfg["wsPort"]?.Value<int>()      ?? wsPort;
                    providerName = cfg["provider"]?.Value<string>() ?? providerName;
                    var su    = cfg["sumup"];
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
                        Console.WriteLine("[SumUp]    ERROR: config.json must have sumup.apiKey, sumup.merchantCode and sumup.readerId");
                        Console.ReadLine(); return;
                    }
                    provider = new SumUpProvider(sumupKey!, sumupMerchant!, sumupReader!);
                }
                else
                {
                    provider = new MyPosProvider(comPort);
                }
                provider.Initialize();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[init]     ERROR: {ex.Message}");
                Console.WriteLine("           Press Enter to exit.");
                Console.ReadLine(); return;
            }

            // ── TLS certificate ────────────────────────────────────────────
            X509Certificate2 cert;
            try { cert = LoadOrCreateCert(); }
            catch (Exception ex)
            {
                Console.WriteLine($"[cert]     ERROR: {ex.Message}");
                Console.ReadLine(); return;
            }

            // ── WSS server ─────────────────────────────────────────────────
            var listener = new TcpListener(IPAddress.Loopback, wsPort);
            listener.Start();

            Console.WriteLine($"\n[bridge]   {provider.Name} ready — wss://localhost:{wsPort}");
            Console.WriteLine("           Open ZollTool POS; the terminal indicator (💳) will turn green.");
            Console.WriteLine("           Press Ctrl+C to stop.\n");

            while (true)
            {
                TcpClient client;
                try { client = await listener.AcceptTcpClientAsync(); }
                catch { break; }
                _ = HandleTcpClient(client, cert);
            }
        }

        // ── Per-connection TLS + WS upgrade ───────────────────────────────────
        static async Task HandleTcpClient(TcpClient tcp, X509Certificate2 cert)
        {
            SslStream? ssl = null;
            try
            {
                ssl = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
                try
                {
                    // SslProtocols.None lets the OS pick TLS 1.2/1.3 automatically
                    await ssl.AuthenticateAsServerAsync(
                        cert, clientCertificateRequired: false,
                        enabledSslProtocols: System.Security.Authentication.SslProtocols.None,
                        checkCertificateRevocation: false);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[bridge]   TLS handshake failed — browser may not trust the cert yet.");
                    Console.WriteLine($"           Visit https://localhost:{wsPort} → Advanced → Proceed to trust it.");
                    Console.WriteLine($"           Detail: {ex.Message}");
                    return;
                }

                // Read HTTP request line + headers
                var headers = await ReadHttpHeaders(ssl);
                if (headers == null) return;

                bool isWs = headers.TryGetValue("upgrade", out var upHdr)
                         && upHdr.Equals("websocket", StringComparison.OrdinalIgnoreCase);

                if (!isWs)
                {
                    // Serve a plain JSON health page (useful for the one-time cert-trust visit)
                    var body  = Encoding.UTF8.GetBytes(
                        $"{{\"bridge\":\"ZollBridge\",\"provider\":\"{provider?.Name ?? "unknown"}\",\"status\":\"ready\"," +
                        $"\"note\":\"Certificate trusted — ZollTool will connect automatically.\"}}");
                    var resp  = $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                                $"Content-Length: {body.Length}\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
                    var rb    = Encoding.ASCII.GetBytes(resp);
                    await ssl.WriteAsync(rb, 0, rb.Length);
                    await ssl.WriteAsync(body, 0, body.Length);
                    Console.WriteLine("[bridge]   Certificate trust page served — browser now trusts the cert.");
                    return;
                }

                // WebSocket handshake (RFC 6455)
                if (!headers.TryGetValue("sec-websocket-key", out var wsKey)) return;
                var accept = ComputeWsAccept(wsKey);
                var shake  = $"HTTP/1.1 101 Switching Protocols\r\n" +
                             $"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
                             $"Sec-WebSocket-Accept: {accept}\r\n\r\n";
                var sb     = Encoding.ASCII.GetBytes(shake);
                await ssl.WriteAsync(sb, 0, sb.Length);

                await HandleClient(ssl);
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   Connection error: {ex.Message}"); }
            finally
            {
                ssl?.Close();
                tcp.Close();
            }
        }

        // ── Read HTTP request headers ──────────────────────────────────────────
        static async Task<Dictionary<string, string>?> ReadHttpHeaders(Stream stream)
        {
            var sb  = new StringBuilder();
            var buf = new byte[1];
            while (true)
            {
                int n = await stream.ReadAsync(buf, 0, 1);
                if (n == 0) return null;
                sb.Append((char)buf[0]);
                int l = sb.Length;
                if (l >= 4
                    && sb[l - 4] == '\r' && sb[l - 3] == '\n'
                    && sb[l - 2] == '\r' && sb[l - 1] == '\n') break;
                if (l > 8192) return null; // safety limit
            }
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in sb.ToString().Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries).Skip(1))
            {
                int i = line.IndexOf(':');
                if (i > 0) headers[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
            }
            return headers;
        }

        // ── WebSocket accept key (RFC 6455 §4.2.2) ────────────────────────────
        static string ComputeWsAccept(string key)
        {
            using var sha = SHA1.Create();
            return Convert.ToBase64String(
                sha.ComputeHash(Encoding.ASCII.GetBytes(key.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        }

        // ── Client session ────────────────────────────────────────────────────
        static async Task HandleClient(Stream stream)
        {
            if (activeStream != null)
                try { activeStream.Close(); } catch { }
            activeStream = stream;

            if (provider is MyPosProvider myposWire)
                myposWire.OnStatusChange = obj =>
                {
                    if (stream == activeStream)
                        _ = WsSend(stream, obj);
                };

            Console.WriteLine("[bridge]   ZollTool connected");
            await WsSend(stream, new { status = "connected", provider = provider?.Name ?? "unknown" });

            CancellationTokenSource? paymentCts = null;
            try
            {
                while (true)
                {
                    var text = await WsReceive(stream);
                    if (text == null) break;
                    if (text.Length == 0) continue; // ping handled inside WsReceive

                    JObject msg;
                    try { msg = JObject.Parse(text); } catch { continue; }

                    var action = msg["action"]?.Value<string>();

                    if (action == "pay" && provider != null)
                    {
                        var amountStr = msg["amount"]?.Value<string>()    ?? "0";
                        var currency  = msg["currency"]?.Value<string>()  ?? "EUR";
                        var reference = msg["reference"]?.Value<string>() ?? Guid.NewGuid().ToString();

                        if (!double.TryParse(amountStr, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out double amount))
                        { await WsSend(stream, new { approved = false, error = "Invalid amount" }); continue; }

                        Console.WriteLine($"[payment]  {amount:F2} {currency} via {provider.Name}");
                        paymentCts = new CancellationTokenSource(TimeSpan.FromMinutes(2));

                        try
                        {
                            var outcome = await provider.PayAsync(amount, currency, reference, paymentCts.Token);
                            Console.WriteLine($"[payment]  approved={outcome.Approved} status={outcome.Status}");
                            await WsSend(stream, new
                            {
                                approved   = outcome.Approved,
                                status     = outcome.Status,
                                auth_code  = outcome.AuthCode,
                                card_brand = outcome.CardBrand,
                                reference,
                            });
                        }
                        catch (OperationCanceledException)
                        {
                            await WsSend(stream, new { approved = false, error = "Payment cancelled or timed out" });
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[payment]  ERROR: {ex.Message}");
                            await WsSend(stream, new { approved = false, error = ex.Message });
                        }
                        finally { paymentCts?.Dispose(); paymentCts = null; }
                    }
                    else if (action == "cancel")
                    {
                        paymentCts?.Cancel();
                        Console.WriteLine("[payment]  Cancelled by ZollTool");
                    }
                    else if (action == "ping")
                    {
                        await WsSend(stream, new { status = "pong" });
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   Error: {ex.Message}"); }
            finally
            {
                paymentCts?.Cancel();
                Console.WriteLine("[bridge]   ZollTool disconnected");
                if (activeStream == stream) activeStream = null;
                if (provider is MyPosProvider myposClear)
                    myposClear.OnStatusChange = null;
            }
        }

        // ── WebSocket frame receive (client → server, client frames are masked) ─
        static async Task<string?> WsReceive(Stream stream)
        {
            try
            {
                var hdr = new byte[2];
                if (!await ReadExact(stream, hdr, 2)) return null;

                int  opcode = hdr[0] & 0x0F;
                if (opcode == 0x8) return null;          // close frame
                bool masked = (hdr[1] & 0x80) != 0;
                long len    = hdr[1] & 0x7F;

                if (len == 126)
                {
                    var ext = new byte[2];
                    if (!await ReadExact(stream, ext, 2)) return null;
                    len = (ext[0] << 8) | ext[1];
                }
                else if (len == 127)
                {
                    var ext = new byte[8];
                    if (!await ReadExact(stream, ext, 8)) return null;
                    len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
                }

                var mask = new byte[4];
                if (masked && !await ReadExact(stream, mask, 4)) return null;

                var payload = new byte[len];
                if (!await ReadExact(stream, payload, (int)len)) return null;
                if (masked) for (int i = 0; i < len; i++) payload[i] ^= mask[i % 4];

                // Respond to ping with pong
                if (opcode == 0x9) { _ = WsSendRaw(stream, 0xA, payload); return ""; }

                return Encoding.UTF8.GetString(payload);
            }
            catch { return null; }
        }

        // ── WebSocket frame send (server → client, server frames are NOT masked) ─
        static Task WsSend(Stream stream, object payload) =>
            WsSendRaw(stream, 0x1, Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(payload)));

        static async Task WsSendRaw(Stream stream, byte opcode, byte[] data)
        {
            int len = data.Length;
            byte[] frame;
            if (len < 126)
            {
                frame = new byte[2 + len];
                frame[0] = (byte)(0x80 | opcode); // FIN + opcode
                frame[1] = (byte)len;
                Buffer.BlockCopy(data, 0, frame, 2, len);
            }
            else if (len < 65536)
            {
                frame = new byte[4 + len];
                frame[0] = (byte)(0x80 | opcode);
                frame[1] = 126;
                frame[2] = (byte)(len >> 8);
                frame[3] = (byte)len;
                Buffer.BlockCopy(data, 0, frame, 4, len);
            }
            else
            {
                frame = new byte[10 + len];
                frame[0] = (byte)(0x80 | opcode);
                frame[1] = 127;
                for (int i = 0; i < 8; i++) frame[2 + i] = (byte)((long)len >> (56 - 8 * i));
                Buffer.BlockCopy(data, 0, frame, 10, len);
            }

            await _sendLock.WaitAsync();
            try   { await stream.WriteAsync(frame, 0, frame.Length); }
            finally { _sendLock.Release(); }
        }

        // ── Read exactly N bytes ───────────────────────────────────────────────
        static async Task<bool> ReadExact(Stream stream, byte[] buf, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int n = await stream.ReadAsync(buf, offset, count - offset);
                if (n == 0) return false;
                offset += n;
            }
            return true;
        }
    }
}
