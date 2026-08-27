package com.phuongninjin.zolltool

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Bluetooth link between two ZollTool devices for the customer display:
 * the display device runs an RFCOMM server (startServer) while the register
 * connects to it (configure + send) and streams newline-delimited
 * DisplayCartMessage JSON. Devices must be paired in Android's Bluetooth
 * settings first — no discovery, so no location permission is involved.
 */
@CapacitorPlugin(
    name = "DisplayLink",
    permissions = [
        Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_CONNECT]),
    ],
)
class DisplayLinkPlugin : Plugin() {

    companion object {
        /** App-specific service UUID — both sides must match. */
        private val LINK_UUID: UUID = UUID.fromString("7e4b1e5e-9f2a-4c3d-8b6f-2a1d0c9e7f55")
        private const val SERVICE_NAME = "ZollToolDisplay"
    }

    private val adapter
        get() = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun needsConnectPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED

    // ── Display side: accept a register and forward its cart frames ──────────

    @Volatile private var serverRunning = false
    private var listenSocket: BluetoothServerSocket? = null
    private var acceptedSocket: BluetoothSocket? = null
    private var serverThread: Thread? = null

    @PluginMethod
    fun startServer(call: PluginCall) {
        if (needsConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "serverPermissionCallback")
            return
        }
        startServerNow(call)
    }

    @PermissionCallback
    private fun serverPermissionCallback(call: PluginCall) {
        if (needsConnectPermission()) call.reject("Bluetooth permission denied")
        else startServerNow(call)
    }

    @SuppressLint("MissingPermission")
    private fun startServerNow(call: PluginCall) {
        val bt = adapter
        if (bt == null || !bt.isEnabled) { call.reject("Bluetooth is off"); return }
        if (serverRunning) { call.resolve(); return }
        serverRunning = true

        serverThread = Thread {
            while (serverRunning) {
                try {
                    val listener = bt.listenUsingRfcommWithServiceRecord(SERVICE_NAME, LINK_UUID)
                    listenSocket = listener
                    val socket = listener.accept() // blocks until a register connects
                    listener.close()
                    listenSocket = null
                    acceptedSocket = socket
                    notifyListeners("linkState", JSObject().apply { put("connected", true) })

                    val reader = BufferedReader(InputStreamReader(socket.inputStream, Charsets.UTF_8))
                    while (serverRunning) {
                        val line = reader.readLine() ?: break
                        if (line.isNotBlank()) {
                            notifyListeners("displayCart", JSObject().apply { put("json", line) })
                        }
                    }
                } catch (_: Exception) {
                    // listen/accept/read failed — fall through and re-listen if still running
                } finally {
                    try { acceptedSocket?.close() } catch (_: Exception) {}
                    acceptedSocket = null
                    notifyListeners("linkState", JSObject().apply { put("connected", false) })
                }
            }
        }
        serverThread!!.start()
        call.resolve()
    }

    @PluginMethod
    fun stopServer(call: PluginCall) {
        serverRunning = false
        try { listenSocket?.close() } catch (_: Exception) {}
        try { acceptedSocket?.close() } catch (_: Exception) {}
        listenSocket = null
        acceptedSocket = null
        call.resolve()
    }

    // ── Register side: connect to the chosen display and stream carts ────────

    private var targetAddress: String? = null
    private var clientSocket: BluetoothSocket? = null
    /** Single writer thread: serializes connects and writes. */
    private val sender = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun configure(call: PluginCall) {
        targetAddress = call.getString("address")
        sender.execute { closeClient() }
        call.resolve()
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val json = call.getString("json") ?: run { call.reject("json required"); return }
        val address = targetAddress ?: run { call.resolve(JSObject().apply { put("sent", false) }); return }
        if (needsConnectPermission()) { call.resolve(JSObject().apply { put("sent", false); put("error", "Bluetooth permission missing") }); return }

        sender.execute {
            val sent = try {
                writeLine(address, json)
                true
            } catch (_: Exception) {
                closeClient()
                // one silent retry — the display may have restarted its listener
                try { writeLine(address, json); true } catch (_: Exception) { closeClient(); false }
            }
            call.resolve(JSObject().apply { put("sent", sent) })
        }
    }

    @SuppressLint("MissingPermission")
    private fun writeLine(address: String, json: String) {
        var socket = clientSocket
        if (socket == null || !socket.isConnected) {
            val bt = adapter ?: throw IllegalStateException("Bluetooth unavailable")
            if (!bt.isEnabled) throw IllegalStateException("Bluetooth is off")
            bt.cancelDiscovery()
            socket = bt.getRemoteDevice(address).createRfcommSocketToServiceRecord(LINK_UUID)
            socket.connect()
            clientSocket = socket
        }
        val out = socket.outputStream
        out.write((json + "\n").toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun closeClient() {
        try { clientSocket?.close() } catch (_: Exception) {}
        clientSocket = null
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        targetAddress = null
        sender.execute { closeClient() }
        call.resolve()
    }

    override fun handleOnDestroy() {
        serverRunning = false
        try { listenSocket?.close() } catch (_: Exception) {}
        try { acceptedSocket?.close() } catch (_: Exception) {}
        sender.execute { closeClient() }
    }
}
