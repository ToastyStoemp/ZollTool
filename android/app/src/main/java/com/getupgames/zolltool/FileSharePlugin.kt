package com.getupgames.zolltool

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "FileShare")
class FileSharePlugin : Plugin() {

    private var pendingContent: String? = null

    @PluginMethod
    fun shareFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run { call.reject("filename required"); return }
        val content  = call.getString("content")  ?: run { call.reject("content required");  return }
        val mimeType = call.getString("mimeType") ?: "application/json"

        try {
            val file = File(activity.cacheDir, filename)
            file.writeText(content)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, filename)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, filename))
            call.resolve(JSObject().apply { put("shared", true) })
        } catch (e: Exception) {
            call.reject("Share failed: ${e.message}")
        }
    }

    @PluginMethod
    fun saveToDevice(call: PluginCall) {
        val filename = call.getString("filename") ?: run { call.reject("filename required"); return }
        val content  = call.getString("content")  ?: run { call.reject("content required");  return }

        pendingContent = content

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        startActivityForResult(call, intent, "saveDocumentResult")
    }

    @ActivityCallback
    private fun saveDocumentResult(call: PluginCall?, result: ActivityResult) {
        val c = call ?: return
        val content = pendingContent
        pendingContent = null

        if (result.resultCode == Activity.RESULT_OK) {
            val uri = result.data?.data ?: run { c.reject("No URI returned"); return }
            try {
                activity.contentResolver.openOutputStream(uri)?.use {
                    it.write(content?.toByteArray() ?: byteArrayOf())
                }
                c.resolve(JSObject().apply { put("saved", true) })
            } catch (e: Exception) {
                c.reject("Write failed: ${e.message}")
            }
        } else {
            c.resolve(JSObject().apply { put("saved", false); put("cancelled", true) })
        }
    }
}
