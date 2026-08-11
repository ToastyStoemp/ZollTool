# ZollBridge

A tiny bridge app that connects myPOS or SumUp payment terminals to ZollTool running in any browser on the same PC.

---

## Supported terminals

| Terminal | Connection | `provider` value |
|---|---|---|
| myPOS Carbon | USB (COM port) | `mypos` |
| myPOS Go2 | Bluetooth SPP | `mypos-bt` |
| SumUp Solo | Cloud REST API | `sumup` |

---

## Setup

### 1. Get the myPOS .NET SDK
- Download `myPOSTerminal.dll` from https://github.com/developermypos/myPOS-SDK-DotNet
- Place it in the `sdk\` folder next to this README
- If Windows blocks the DLL (downloaded from the internet), right-click → Properties → Unblock, or run:
  ```
  Unblock-File .\sdk\myPOSTerminal.dll
  ```

### 2. Create your local config
`config.json` holds real values (COM port, your SumUp secret key) and is gitignored —
`config.example.json` is the tracked template:
```
copy config.example.json config.json
```
Edit the **copy** (`config.json`) in the steps below, never the tracked template.

---

## myPOS Carbon (USB)

### 3a. Configure the COM port
- Plug the Carbon into the PC via USB; set USB mode to **PTP/MTP** on the device
- Open **Device Manager → Ports (COM & LPT)** and note which COM port appears (e.g. COM3, COM5)
- Edit `config.json`:
  ```json
  { "provider": "mypos", "comPort": "COM3", "wsPort": 8765 }
  ```

---

## myPOS Go2 (Bluetooth)

### 3b. Pair and configure Bluetooth
1. On the Go2, open **Settings → Bluetooth** and make it discoverable
2. On the PC, open **Settings → Bluetooth & devices → Add a device**
3. Pair the Go2 — Windows will install a virtual COM port
4. Open **Device Manager → Ports (COM & LPT)** and look for a **Bluetooth Serial Port** — note the port number (e.g. COM5)
   - Windows may create two ports (incoming/outgoing); use the **outgoing** one
5. Edit `config.json`:
   ```json
   { "provider": "mypos-bt", "comPort": "COM5", "wsPort": 8765 }
   ```

**Reconnect behaviour:** Unlike USB, Windows keeps the virtual COM port in the list even when the Go2 is off. ZollBridge detects disconnection via SDK communication errors and then retries `Initialize()` every 10 seconds until the device is back in range — no restart needed.

---

## SumUp Solo

### 3c. Configure SumUp
- Create an API key at https://developer.sumup.com (use a **secret/personal** key starting with `sup_sk_`)
- Find your merchant code in the SumUp dashboard
- Find your reader ID in the hardware section of the dashboard
- Edit `config.json`:
  ```json
  {
    "provider": "sumup",
    "sumup": {
      "apiKey": "sup_sk_...",
      "merchantCode": "YOUR_MERCHANT_CODE",
      "readerId": "YOUR_READER_ID"
    }
  }
  ```

---

## Build

Requires .NET SDK 6+ (for the build tooling) or Visual Studio 2019+.

```
dotnet build
dotnet run
```

Or open `ZollBridge.csproj` in Visual Studio and press F5.

---

## Run at startup (optional)

To have it start automatically with Windows:
- Build a Release version: `dotnet publish -c Release`
- Create a shortcut to the `.exe` in `%AppData%\Microsoft\Windows\Start Menu\Programs\Startup`

---

## Usage

1. Start ZollBridge — you'll see `[provider] ready — ws://localhost:8765`
2. Open ZollTool POS in Chrome — the terminal indicator (💳) in the header turns green
3. Press **Card** — the amount goes straight to the terminal
4. Customer taps/inserts card — result comes back automatically

### Indicator states

| Indicator | Meaning |
|---|---|
| 💳 ● myPOS | Bridge connected and terminal ready |
| 💳 ⚠ | Bridge connected but terminal offline (USB unplugged or BT out of range) — reconnecting automatically |
| 💳 ○ | ZollBridge app not reachable — retrying |
| 💳 Connect | Gave up after 5 minutes — click to retry |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not connect to COM port" | Check Device Manager for the right port number |
| Indicator stays grey in ZollTool | Make sure ZollBridge.exe is running; check Windows Firewall isn't blocking localhost |
| Indicator shows ⚠ (amber) | Terminal is offline — plug in USB / bring Go2 in range; reconnects automatically |
| Payment times out | Check the terminal is powered on and not showing an error |
| Go2 Bluetooth not finding COM port | Check Device Manager; ensure pairing is complete; use the *outgoing* port |
| Build error on myPOSTerminal namespace | DLL may be blocked by Windows — see Unblock step above |
