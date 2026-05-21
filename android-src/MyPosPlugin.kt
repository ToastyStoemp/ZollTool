package com.getupgames.zolltool

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.mypos.slavesdk.ConnectionListener
import com.mypos.slavesdk.ConnectionType
import com.mypos.slavesdk.Currency
import com.mypos.slavesdk.Language
import com.mypos.slavesdk.POSHandler
import com.mypos.slavesdk.POSInfoListener
import com.mypos.slavesdk.POSReadyListener
import com.mypos.slavesdk.TransactionData
import java.util.UUID

@CapacitorPlugin(name = "MyPos")
class MyPosPlugin : Plugin(), POSInfoListener, ConnectionListener, POSReadyListener {

    private lateinit var pos: POSHandler
    private var pendingCall: PluginCall? = null
    private var callResolved  = false
    private var termConnected = false   // physical BT link up
    private var termReady     = false   // SDK handshake complete, safe to transact

    // ── BroadcastReceivers ────────────────────────────────────────────────────

    // Auto-accepts the BLE pairing PIN from the GO2 without showing a system dialog.
    // Without this, the system dialog appears and auto-dismisses in ~5 s → GO2 sees "connection error".
    private val pairingReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != BluetoothDevice.ACTION_PAIRING_REQUEST) return
            val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
            val pin    = intent.getIntExtra("android.bluetooth.device.extra.PAIRING_KEY", 123456)
            device.setPin(pin.toString().toByteArray())
            device.createBond()
            abortBroadcast()
        }
    }

    private val disconnectReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != BluetoothDevice.ACTION_ACL_DISCONNECTED) return
            termConnected = false
            termReady     = false
            notifyListeners("terminalStatus", JSObject().apply { put("connected", false) })
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun load() {
        POSHandler.setConnectionType(ConnectionType.BLUETOOTH)
        POSHandler.setCurrency(Currency.EUR)
        POSHandler.setApplicationContext(activity.applicationContext)
        POSHandler.setLanguage(Language.ENGLISH)
        POSHandler.setDefaultReceiptConfig(POSHandler.RECEIPT_DO_NOT_PRINT)

        pos = POSHandler.getInstance()
        pos.setPOSInfoListener(this)
        pos.setConnectionListener(this)
        pos.setPOSReadyListener(this)

        // Register BLE pairing receiver with highest priority so we handle it before the system dialog
        val pairingFilter = IntentFilter(BluetoothDevice.ACTION_PAIRING_REQUEST)
        pairingFilter.priority = IntentFilter.SYSTEM_HIGH_PRIORITY
        activity.registerReceiver(pairingReceiver, pairingFilter)

        activity.registerReceiver(disconnectReceiver,
            IntentFilter(BluetoothDevice.ACTION_ACL_DISCONNECTED))

        // Put Android into connectable state immediately so the GO2 can find us at any time.
        // Permission check first — connectDevice is called again in onRequestPermissionsResult if needed.
        if (pos.checkPermissions(activity)) {
            pos.connectDevice(activity)
        }
    }

    override fun handleOnDestroy() {
        try { activity.unregisterReceiver(pairingReceiver)    } catch (_: Exception) {}
        try { activity.unregisterReceiver(disconnectReceiver) } catch (_: Exception) {}
    }

    // ── Plugin methods ────────────────────────────────────────────────────────

    /** Re-enter connectable state (e.g. after the user taps Connect in the setup screen). */
    @PluginMethod
    fun connectTerminal(call: PluginCall) {
        if (pos.checkPermissions(activity)) {
            pos.connectDevice(activity)
        }
        call.resolve()
    }

    /** Current status polled by the setup screen. */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("connected", termReady) // only true once fully handshaked
        call.resolve(ret)
    }

    /**
     * Start a card payment on the GO2.
     * Params:   { amount: number, currency: string }
     * Resolves: { approved: bool, transactionId?, cardBrand?, authCode?, error? }
     */
    @PluginMethod
    fun startPayment(call: PluginCall) {
        if (!termReady) { call.reject("Terminal not ready"); return }
        if (pendingCall != null) { call.reject("Payment already in progress"); return }

        val amount   = call.getDouble("amount")   ?: run { call.reject("amount required"); return }
        val currency = call.getString("currency") ?: "CHF"

        val posCurrency = when (currency.uppercase()) {
            "CHF" -> Currency.CHF; "EUR" -> Currency.EUR; "GBP" -> Currency.GBP
            "USD" -> Currency.USD; "SEK" -> Currency.SEK; "NOK" -> Currency.NOK
            "DKK" -> Currency.DKK; else  -> Currency.EUR
        }

        POSHandler.setCurrency(posCurrency)
        pendingCall  = call
        callResolved = false

        pos.purchase(
            String.format("%.2f", amount),
            UUID.randomUUID().toString(),
            POSHandler.RECEIPT_DO_NOT_PRINT
        )
    }

    // ── ConnectionListener ────────────────────────────────────────────────────

    override fun onConnected(device: BluetoothDevice?) {
        termConnected = true
        // termReady is set by POSReadyListener — don't notify yet
    }

    // ── POSReadyListener ──────────────────────────────────────────────────────

    override fun onPOSReady() {
        termReady = true
        notifyListeners("terminalStatus", JSObject().apply { put("connected", true) })
    }

    // ── POSInfoListener ───────────────────────────────────────────────────────

    override fun onTransactionComplete(transactionData: TransactionData?) {
        if (callResolved) return
        val call = pendingCall ?: return
        pendingCall = null; callResolved = true
        call.resolve(JSObject().apply {
            put("approved",      true)
            put("transactionId", transactionData?.stan     ?: "")
            put("cardBrand",     transactionData?.aidName  ?: "")
            put("authCode",      transactionData?.authCode ?: "")
        })
    }

    override fun onPOSInfoReceived(command: Int, status: Int, description: String?, extra: Bundle?) {
        if (status >= 0 || callResolved) return
        val call = pendingCall ?: return
        pendingCall = null; callResolved = true
        call.resolve(JSObject().apply {
            put("approved", false)
            put("error",    description ?: "Payment declined (status $status)")
        })
    }
}
