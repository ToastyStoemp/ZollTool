using System;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using myPOS;

namespace ZollBridge
{
    class Program
    {
        static myPOSTerminal? terminal;
        static WebSocket? activeSocket;
        static string? pendingReference;

        static async Task Main(string[] args)
        {
            // ── Load config ────────────────────────────────────────────────
            string comPort = "COM3";
            int wsPort     = 8765;

            if (File.Exists("config.json"))
            {
                try
                {
                    var cfg = JObject.Parse(File.ReadAllText("config.json"));
                    comPort = cfg["comPort"]?.Value<string>() ?? comPort;
                    wsPort  = cfg["wsPort"]?.Value<int>()    ?? wsPort;
                }
                catch { Console.WriteLine("[config] Could not parse config.json, using defaults."); }
            }

            // Allow override via command line: ZollBridge.exe COM4 9000
            if (args.Length >= 1) comPort = args[0];
            if (args.Length >= 2 && int.TryParse(args[1], out int p)) wsPort = p;

            // ── Connect terminal ───────────────────────────────────────────
            Console.WriteLine($"[terminal] Connecting on {comPort}...");
            try
            {
                terminal = new myPOSTerminal();
                terminal.SetLanguage(Language.English);
                terminal.SetReceiptMode(ReceiptMode.MerchantOnly);
                terminal.Initialize(comPort);
                terminal.ProcessingFinished += OnPaymentResult;
                Console.WriteLine($"[terminal] Connected on {comPort}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[terminal] ERROR: {ex.Message}");
                Console.WriteLine("           Check that the Carbon is plugged in and the COM port is correct.");
                Console.WriteLine("           Edit config.json to change the port. Press Enter to exit.");
                Console.ReadLine();
                return;
            }

            // ── Start WebSocket server ─────────────────────────────────────
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{wsPort}/");
            listener.Start();
            Console.WriteLine($"[bridge]   Listening on ws://localhost:{wsPort}");
            Console.WriteLine("           Open ZollTool POS in your browser — the terminal indicator will turn green.");
            Console.WriteLine("           Press Ctrl+C to stop.\n");

            while (true)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); }
                catch { break; }

                if (ctx.Request.IsWebSocketRequest)
                {
                    var wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null);
                    _ = HandleClient(wsCtx.WebSocket);
                }
                else
                {
                    // HTTP ping — lets ZollTool check the bridge is up
                    ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    ctx.Response.StatusCode  = 200;
                    ctx.Response.ContentType = "application/json";
                    var body = Encoding.UTF8.GetBytes("{\"bridge\":\"ZollBridge\",\"status\":\"ready\"}");
                    await ctx.Response.OutputStream.WriteAsync(body, 0, body.Length);
                    ctx.Response.Close();
                }
            }
        }

        // ── WebSocket client handler ───────────────────────────────────────
        static async Task HandleClient(WebSocket ws)
        {
            // Replace any existing connection
            if (activeSocket != null && activeSocket.State == WebSocketState.Open)
            {
                try { await activeSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "replaced", CancellationToken.None); }
                catch { }
            }
            activeSocket = ws;

            Console.WriteLine("[bridge]   ZollTool connected");
            await Send(ws, new { status = "connected" });

            var buf = new byte[4096];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close) break;

                    var raw = Encoding.UTF8.GetString(buf, 0, result.Count);
                    JObject msg;
                    try { msg = JObject.Parse(raw); }
                    catch { continue; }

                    var action = msg["action"]?.Value<string>();

                    if (action == "pay")
                    {
                        var amountStr = msg["amount"]?.Value<string>()    ?? "0";
                        var currStr   = msg["currency"]?.Value<string>()  ?? "CHF";
                        var reference = msg["reference"]?.Value<string>() ?? Guid.NewGuid().ToString();

                        if (!double.TryParse(amountStr, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out double amount))
                        {
                            await Send(ws, new { approved = false, error = "Invalid amount" });
                            continue;
                        }

                        var currency = currStr.ToUpperInvariant() switch
                        {
                            "CHF" => Currencies.CHF,
                            "GBP" => Currencies.GBP,
                            "USD" => Currencies.USD,
                            "NOK" => Currencies.NOK,
                            "SEK" => Currencies.SEK,
                            "DKK" => Currencies.DKK,
                            _     => Currencies.EUR,
                        };

                        pendingReference = reference;
                        Console.WriteLine($"[payment]  {amount:F2} {currency} ref={reference}");
                        terminal!.Purchase(
                            amount,
                            tip: 0.0,
                            currency,
                            ReferenceNumberType.ReferenceNumber,
                            reference_number: reference,
                            operator_code: "");
                        // result arrives asynchronously via OnPaymentResult
                    }
                    else if (action == "ping")
                    {
                        await Send(ws, new { status = "pong" });
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[bridge]   Client error: {ex.Message}");
            }
            finally
            {
                Console.WriteLine("[bridge]   ZollTool disconnected");
                if (activeSocket == ws) activeSocket = null;
            }
        }

        // ── Payment result callback ────────────────────────────────────────
        static void OnPaymentResult(ProcessingResult r)
        {
            bool approved = r.Status == TransactionStatus.Success
                         || r.Status == TransactionStatus.SuccessWithInfo;

            var d = r.TranData;
            Console.WriteLine($"[payment]  status={r.Status} auth={d?.AuthCode} card={d?.AIDName}");

            if (activeSocket?.State == WebSocketState.Open)
            {
                Send(activeSocket, new
                {
                    approved   = approved,
                    status     = r.Status.ToString(),
                    auth_code  = d?.AuthCode  ?? "",
                    card_brand = d?.AIDName   ?? "",
                    pan_masked = d?.PANMasked ?? "",
                    stan       = d?.Stan      ?? "",
                    amount     = d?.Amount    ?? "",
                    reference  = pendingReference ?? "",
                }).GetAwaiter().GetResult();
            }
        }

        // ── Helper ─────────────────────────────────────────────────────────
        static async Task Send(WebSocket ws, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(payload));
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }
}
