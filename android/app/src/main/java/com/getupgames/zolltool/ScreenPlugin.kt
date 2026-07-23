package com.getupgames.zolltool

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.view.WindowManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Wakes the device screen from an off/locked state — used by the customer
 * display and the register to turn the terminal back on when a cart update
 * arrives. There is no public Android API to force the screen off; the
 * counterpart is simply holding no wake lock and relying on the terminal's
 * own (short) display timeout.
 *
 * setTurnScreenOn/setShowWhenLocked (API 27) and requestDismissKeyguard
 * (API 26) don't exist below Oreo — the compat flavor targets API 24
 * (Android 7), so this falls back to the older WindowManager flags there.
 */
@CapacitorPlugin(name = "Screen")
class ScreenPlugin : Plugin() {
    @PluginMethod
    fun wake(call: PluginCall) {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                activity.setTurnScreenOn(true)
                activity.setShowWhenLocked(true)
            } else {
                @Suppress("DEPRECATION")
                activity.window.addFlags(
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                )
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val km = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                km.requestDismissKeyguard(activity, null)
            }
        }
        call.resolve()
    }
}
