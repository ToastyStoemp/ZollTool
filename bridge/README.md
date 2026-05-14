# ZollBridge

A tiny bridge app that connects the myPOS Carbon terminal (via USB) to ZollTool running in any browser on the same PC.

## Setup

### 1. Get the myPOS .NET SDK
- Download `myPOSTerminal.dll` from https://github.com/developermypos/myPOS-SDK-DotNet
- Place it in the `sdk\` folder next to this README

### 2. Configure the COM port
- Plug the Carbon into the PC via USB
- Open **Device Manager → Ports (COM & LPT)** and note which COM port appears (e.g. COM3, COM5)
- Edit `config.json`:
  ```json
  { "comPort": "COM3", "wsPort": 8765 }
  ```

### 3. Build
Requires .NET SDK 6+ (for the build tooling) or Visual Studio 2019+.

```
dotnet build
dotnet run
```

Or open `ZollBridge.csproj` in Visual Studio and press F5.

### 4. Run at startup (optional)
To have it start automatically with Windows:
- Build a Release version: `dotnet publish -c Release`
- Create a shortcut to the `.exe` in `%AppData%\Microsoft\Windows\Start Menu\Programs\Startup`

## Usage

1. Start ZollBridge — you'll see `Listening on ws://localhost:8765`
2. Open ZollTool POS in Chrome — the terminal indicator (💳) in the header turns green
3. Press **Card** — the amount goes straight to the terminal, no dialog needed
4. Customer taps/inserts card — result comes back automatically

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not connect to COM port" | Check Device Manager for the right port number |
| Indicator stays grey in ZollTool | Make sure ZollBridge.exe is running; check Windows Firewall isn't blocking localhost |
| Payment times out | Check the terminal is powered on and not showing an error |
| Build error on myPOSTerminal namespace | Check the SDK docs for the correct `using` statement for your SDK version |
