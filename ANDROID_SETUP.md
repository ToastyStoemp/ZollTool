# ZollTool Android Setup

Build ZollTool as a sideloadable APK that runs on Android tablets/phones and processes card payments directly via a paired myPOS GO2 terminal over Bluetooth.

---

## Prerequisites

- Node.js 18+
- Android Studio
- Android SDK with API 26+
- myPOS GO2 terminal (Bluetooth, already activated)
- A PC running ZollBridge on the same LAN

---

## 1  Install Capacitor dependencies

```
npm install
```

---

## 2  Add the Android platform

```
npx cap add android
npx cap sync android
```

---

## 3  Register the myPOS plugin

### 3a  Copy the plugin source file

```
copy android-src\MyPosPlugin.kt  android\app\src\main\java\com\phuongninjin\zolltool\MyPosPlugin.kt
```

### 3b  Edit MainActivity.java to register the plugin

Open `android/app/src/main/java/com/phuongninjin/zolltool/MainActivity.java` and replace it with:

```java
package com.phuongninjin.zolltool;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MyPosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

### 3c  Add myPOS Slave SDK

**Project-level** `android/build.gradle` — add to `allprojects.repositories`:

```gradle
allprojects {
    repositories {
        mavenCentral()
    }
}
```

**App-level** `android/app/build.gradle` — add to `dependencies`:

```gradle
implementation 'com.mypos:slavesdk:2.1.8'
```

Also ensure `minSdk` is at least 21 in the same file:

```gradle
android {
    defaultConfig {
        minSdk 21
    }
}
```

### 3d  Add Bluetooth permissions

Edit `android/app/src/main/AndroidManifest.xml` — add inside `<manifest>` before `<application>`:

```xml
<!-- Bluetooth permissions for myPOS GO2 -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<!-- Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
```

### 3e  Enable Kotlin in Gradle (needed for MyPosPlugin.kt)

**Project-level** `android/build.gradle` — add to `buildscript.dependencies`:

```gradle
classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'
```

**App-level** `android/app/build.gradle` — add near the top with the other `apply plugin` lines:

```gradle
apply plugin: 'kotlin-android'
```

---

## 4  Pair the GO2 terminal

1. Power on the GO2 and enable **Slave mode → Bluetooth** in its settings
2. On the Android device: **Settings → Bluetooth** → pair the GO2
3. Open ZollTool — tap **⚙** in the header — the terminal status dot turns green when connected

---

## 5  Build and sign the APK

### Debug build (for testing)

```
npx cap sync android
cd android
gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release build (for distribution)

1. Generate a keystore (once):
   ```
   keytool -genkey -v -keystore zolltool.keystore -alias zolltool -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Copy keystore to `android/app/zolltool.keystore`
3. Add to `android/app/build.gradle`:
   ```gradle
   android {
       signingConfigs {
           release {
               storeFile file('zolltool.keystore')
               storePassword 'YOUR_PASSWORD'
               keyAlias 'zolltool'
               keyPassword 'YOUR_PASSWORD'
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
               minifyEnabled false
           }
       }
   }
   ```
4. Build:
   ```
   cd android
   gradlew assembleRelease
   ```
5. APK: `android/app/build/outputs/apk/release/app-release.apk`

---

## 6  Sideload the APK

On the Android device:

1. **Settings → Security → Install unknown apps** → allow your file manager
2. Copy the APK to the device (USB, email, shared folder, etc.)
3. Open the APK and tap **Install**

---

## 7  First-time app setup

1. Open ZollTool on the Android device
2. The setup screen appears automatically — enter:
   - **Bridge IP**: IP of the PC running ZollBridge (printed in the ZollBridge console on startup)
   - **Device name**: e.g. `Cashier 1`
3. Tap **Connect** — products load automatically
4. The **⚙** button in the header reopens this screen at any time

---

## 8  SumUp card reader (full build only)

The **full** APK flavor bundles the SumUp Merchant SDK (SumUp Solo, Air, …). To connect a reader:

1. Create an **affiliate key** in the [SumUp developer portal](https://developer.sumup.com/) → *Affiliate keys / API keys*.
2. **Set the affiliate key's Application Identifiers to `com.phuongninjin.zolltool`** — the app's Android package name. SumUp binds each affiliate key to specific application IDs, so a key registered for any other identifier makes login **fail with an "invalid credentials" error even when the email and password are correct**. This is the most common cause of SumUp login failures.
3. In ZollTool → **Settings → Payments** (or the setup wizard's *Currency & payments* step), paste the affiliate key, tap **Log in to SumUp**, and sign in with your SumUp **merchant** account.
4. The reader pairs over Bluetooth from SumUp's checkout screen the first time you take a payment, and is remembered afterwards.

> SumUp ships only in the `full` flavor — on `compat`/`carbon` the SumUp option stays disabled. The affiliate key is stored as a synced setting, so it propagates to your other devices; each device still logs in and pairs its own reader.

---

## Architecture summary

```
Android device (ZollTool APK)
  └── www/remote.html  (Capacitor WebView)
        ├── WebSocket → ZollBridge:8766  (catalog sync, cash orders)
        └── Capacitor.Plugins.MyPos      (local card payment via GO2 BT)
                └── myPOS Slave SDK v2.1.8 → GO2 terminal (Bluetooth)

PC (ZollBridge.exe)
  ├── :8765  WSS  ← www/pos.html  (master POS)
  └── :8766  WS   ← Android remotes + web remotes
```

When an Android cashier presses **Pay with Card**:
1. `MyPos.startPayment()` is called natively → GO2 processes the card locally
2. On success the app sends `order_self_paid` to ZollBridge over WebSocket
3. ZollBridge forwards it to pos.html as `remote_self_paid`
4. pos.html records inventory + broadcasts updated catalog to all devices
5. The Android app receives `order_result` → success toast + cart cleared

Each Android device talks directly to its own paired GO2 — the PC terminal is not involved.
