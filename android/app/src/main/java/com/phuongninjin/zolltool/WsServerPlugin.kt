package com.phuongninjin.zolltool

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Embedded WebSocket server plugin.
 *
 * Lets pos.html act as a WiFi host (replacing the ZollBridge desktop app).
 * Remote clients connect to ws://<device-ip>:8766 exactly as they would to ZollBridge.
 *
 * JS API:
 *   WsServer.start({ port })          → { port }
 *   WsServer.stop()
 *   WsServer.send({ clientId, data }) — send string to one client
 *   WsServer.broadcast({ data })      — send string to all clients
 *   WsServer.getLocalIp()             → { ip }
 *
 * Events emitted to JS:
 *   "clientConnected"    { clientId }
 *   "clientDisconnected" { clientId }
 *   "message"            { clientId, data }
 *   "serverError"        { error }
 */
@CapacitorPlugin(name = "WsServer")
class WsServerPlugin : Plugin() {

    private var server: EmbeddedServer? = null
    private val clients = ConcurrentHashMap<String, WebSocket>()
    private val idSeq   = AtomicInteger(0)

    @PluginMethod
    fun start(call: PluginCall) {
        val port = call.getInt("port", 8766)!!
        if (server != null) {
            call.resolve(JSObject().apply { put("port", port) })
            return
        }
        try {
            val srv = EmbeddedServer(port)
            srv.isReuseAddr = true
            srv.start()
            server = srv
            call.resolve(JSObject().apply { put("port", port) })
        } catch (e: Exception) {
            call.reject("Failed to start server: ${e.message}")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try { server?.stop(500) } catch (_: Exception) {}
        server = null
        clients.clear()
        call.resolve()
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val clientId = call.getString("clientId") ?: run { call.reject("clientId required"); return }
        val data     = call.getString("data")     ?: run { call.reject("data required"); return }
        clients[clientId]?.send(data)
        call.resolve()
    }

    @PluginMethod
    fun broadcast(call: PluginCall) {
        val data = call.getString("data") ?: run { call.reject("data required"); return }
        clients.values.forEach { it.send(data) }
        call.resolve()
    }

    @PluginMethod
    fun getLocalIp(call: PluginCall) {
        val ip = try {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.flatMap { it.inetAddresses.toList() }
                ?.firstOrNull { !it.isLoopbackAddress && it is Inet4Address }
                ?.hostAddress ?: "unknown"
        } catch (_: Exception) { "unknown" }
        call.resolve(JSObject().apply { put("ip", ip) })
    }

    override fun handleOnDestroy() {
        try { server?.stop(500) } catch (_: Exception) {}
        server = null
    }

    // ── Internal WebSocket server ─────────────────────────────────────────

    inner class EmbeddedServer(port: Int) : WebSocketServer(InetSocketAddress(port)) {

        override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
            val id = "c${idSeq.incrementAndGet()}"
            conn.setAttachment(id)
            clients[id] = conn
            notifyListeners("clientConnected",    JSObject().apply { put("clientId", id) })
        }

        override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
            val id = conn.getAttachment<String>() ?: return
            clients.remove(id)
            notifyListeners("clientDisconnected", JSObject().apply { put("clientId", id) })
        }

        override fun onMessage(conn: WebSocket, message: String) {
            val id = conn.getAttachment<String>() ?: return
            notifyListeners("message", JSObject().apply {
                put("clientId", id)
                put("data",     message)
            })
        }

        override fun onError(conn: WebSocket?, ex: Exception) {
            notifyListeners("serverError", JSObject().apply { put("error", ex.message ?: "") })
        }

        override fun onStart() {}
    }
}
