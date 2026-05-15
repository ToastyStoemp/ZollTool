using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
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
    // myPOS provider — USB COM port, event-based SDK
    // ══════════════════════════════════════════════════════════════════════════
    class MyPosProvider : IPaymentProvider
    {
        readonly myPOSTerminal _terminal = new myPOSTerminal();
        readonly string _comPort;
        TaskCompletionSource<PaymentOutcome>? _tcs;

        public string Name => "myPOS";

        public MyPosProvider(string comPort) => _comPort = comPort;

        public void Initialize()
        {
            _terminal.SetLanguage(Language.English);
            _terminal.SetReceiptMode(ReceiptMode.MerchantOnly);
            _terminal.Initialize(_comPort);
            _terminal.ProcessingFinished += OnResult;
            Console.WriteLine($"[myPOS]    Connected on {_comPort}");
        }

        public Task<PaymentOutcome> PayAsync(double amount, string currency, string reference, CancellationToken ct)
        {
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
            // SumUp amounts are in minor units (e.g. CHF 12.50 → value=1250, minor_unit=2)
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

            // Poll every 2 s for up to 2 minutes
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
    // Bridge — WebSocket server, routes to whichever provider is configured
    // ══════════════════════════════════════════════════════════════════════════
    class Program
    {
        static IPaymentProvider? provider;
        static WebSocket? activeSocket;

        static async Task Main(string[] args)
        {
            // ── Load config ────────────────────────────────────────────────
            string comPort      = "COM3";
            int    wsPort       = 8765;
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

            // CLI override: ZollBridge.exe [mypos|sumup] [COM3]
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

            // ── WebSocket server ───────────────────────────────────────────
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{wsPort}/");
            listener.Start();

            Console.WriteLine($"\n[bridge]   {provider.Name} ready — ws://localhost:{wsPort}");
            Console.WriteLine("           Open ZollTool POS; the terminal indicator will turn green.");
            Console.WriteLine("           Press Ctrl+C to stop.\n");

            while (true)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); } catch { break; }

                if (ctx.Request.IsWebSocketRequest)
                {
                    _ = HandleClient((await ctx.AcceptWebSocketAsync(null)).WebSocket);
                }
                else
                {
                    ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    ctx.Response.StatusCode  = 200;
                    ctx.Response.ContentType = "application/json";
                    var pong = Encoding.UTF8.GetBytes(
                        $"{{\"bridge\":\"ZollBridge\",\"provider\":\"{provider.Name}\",\"status\":\"ready\"}}");
                    await ctx.Response.OutputStream.WriteAsync(pong, 0, pong.Length);
                    ctx.Response.Close();
                }
            }
        }

        static async Task HandleClient(WebSocket ws)
        {
            if (activeSocket?.State == WebSocketState.Open)
                try { await activeSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "replaced", CancellationToken.None); }
                catch { }

            activeSocket = ws;
            Console.WriteLine("[bridge]   ZollTool connected");
            await Send(ws, new { status = "connected", provider = provider?.Name ?? "unknown" });

            CancellationTokenSource? paymentCts = null;
            var buf = new byte[4096];

            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var frame = await ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                    if (frame.MessageType == WebSocketMessageType.Close) break;

                    JObject msg;
                    try { msg = JObject.Parse(Encoding.UTF8.GetString(buf, 0, frame.Count)); }
                    catch { continue; }

                    var action = msg["action"]?.Value<string>();

                    if (action == "pay" && provider != null)
                    {
                        var amountStr = msg["amount"]?.Value<string>()    ?? "0";
                        var currency  = msg["currency"]?.Value<string>()  ?? "EUR";
                        var reference = msg["reference"]?.Value<string>() ?? Guid.NewGuid().ToString();

                        if (!double.TryParse(amountStr, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out double amount))
                        { await Send(ws, new { approved = false, error = "Invalid amount" }); continue; }

                        Console.WriteLine($"[payment]  {amount:F2} {currency} via {provider.Name}");
                        paymentCts = new CancellationTokenSource(TimeSpan.FromMinutes(2));

                        try
                        {
                            var outcome = await provider.PayAsync(amount, currency, reference, paymentCts.Token);
                            Console.WriteLine($"[payment]  approved={outcome.Approved} status={outcome.Status}");
                            await Send(ws, new
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
                            await Send(ws, new { approved = false, error = "Payment cancelled or timed out" });
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[payment]  ERROR: {ex.Message}");
                            await Send(ws, new { approved = false, error = ex.Message });
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
                        await Send(ws, new { status = "pong" });
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"[bridge]   Error: {ex.Message}"); }
            finally
            {
                paymentCts?.Cancel();
                Console.WriteLine("[bridge]   ZollTool disconnected");
                if (activeSocket == ws) activeSocket = null;
            }
        }

        static async Task Send(WebSocket ws, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(payload));
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }
}
