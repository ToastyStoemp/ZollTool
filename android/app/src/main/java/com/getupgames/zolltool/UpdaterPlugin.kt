package com.getupgames.zolltool

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.URL

/**
 * Self-update: reads this install's own version, and downloads + launches
 * the Android package installer for a newer APK served by the sync server
 * (see server/src/routes/updates.ts). Installing still requires the user's
 * explicit consent via the system "install unknown app" prompt — Android
 * doesn't allow a regular app to silently replace itself.
 */
@CapacitorPlugin(name = "Updater")
class UpdaterPlugin : Plugin() {
    @PluginMethod
    fun getCurrentVersion(call: PluginCall) {
        val pInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
        val result = JSObject()
        result.put("versionCode", PackageInfoCompat.getLongVersionCode(pInfo))
        result.put("versionName", pInfo.versionName)
        call.resolve(result)
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val urlString = call.getString("url") ?: run { call.reject("url required"); return }
        Thread {
            try {
                val file = File(activity.cacheDir, "update.apk")
                URL(urlString).openStream().use { input ->
                    FileOutputStream(file).use { output -> input.copyTo(output) }
                }
                val uri: Uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.runOnUiThread {
                    activity.startActivity(intent)
                    call.resolve()
                }
            } catch (e: Exception) {
                activity.runOnUiThread { call.reject(e.message ?: "Download failed") }
            }
        }.start()
    }
}
