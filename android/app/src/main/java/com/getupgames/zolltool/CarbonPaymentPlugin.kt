package com.getupgames.zolltool

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID

/**
 * On-device payment plugin for myPOS Carbon (and other Android POS terminals).
 *
 * Triggers a payment via Android Intent — the standard integration path for apps
 * running ON a myPOS Carbon / Smart device.
 *
 * ⚠ Intent action & package: verify against your exact Carbon firmware / myPOS dev docs.
 *   Common values for myPOS Carbon:
 *     action  = "com.mypos.integrationsdk.PAYMENT"
 *     package = "com.mypos.smartpos"
 *   Some older firmware uses "com.mypos.action.PAYMENT" — adjust PAYMENT_ACTION below.
 *
 * Result extras expected from the payment app (STATUS == 0 means approved):
 *   STATUS        Int     0 = approved, anything else = declined/error
 *   STATUS_MSG    String  human-readable decline reason
 *   TRANSACTION_ID String
 *   CARD_BRAND    String  e.g. "VISA"
 *   AUTH_CODE     String
 */
@CapacitorPlugin(name = "CarbonPayment")
class CarbonPaymentPlugin : Plugin() {

    companion object {
        private const val PAYMENT_ACTION  = "com.mypos.integrationsdk.PAYMENT"
        private const val PAYMENT_PACKAGE = "com.mypos.smartpos"
        private const val CALLBACK_TAG    = "paymentResult"
    }

    @PluginMethod
    fun startPayment(call: PluginCall) {
        val amount   = call.getDouble("amount")   ?: run { call.reject("amount required"); return }
        val currency = call.getString("currency") ?: "EUR"

        val currencyCode = when (currency.uppercase()) {
            "CHF" -> 756; "EUR" -> 978; "GBP" -> 826
            "USD" -> 840; "SEK" -> 752; "NOK" -> 578
            "DKK" -> 208; else  -> 978
        }

        val intent = Intent(PAYMENT_ACTION).apply {
            setPackage(PAYMENT_PACKAGE)
            putExtra("AMOUNT",          String.format("%.2f", amount))
            putExtra("CURRENCY_CODE",   currencyCode)
            putExtra("TRANSACTION_ID",  UUID.randomUUID().toString())
            putExtra("PRINT_RECEIPT",   false)
        }

        try {
            startActivityForResult(call, intent, CALLBACK_TAG)
        } catch (e: Exception) {
            call.reject("Terminal not available: ${e.message}")
        }
    }

    @ActivityCallback
    private fun paymentResult(call: PluginCall?, result: ActivityResult) {
        val c = call ?: return
        if (result.resultCode == Activity.RESULT_OK) {
            val data   = result.data
            val status = data?.getIntExtra("STATUS", -1) ?: -1
            if (status == 0) {
                c.resolve(JSObject().apply {
                    put("approved",      true)
                    put("transactionId", data?.getStringExtra("TRANSACTION_ID") ?: "")
                    put("cardBrand",     data?.getStringExtra("CARD_BRAND")     ?: "")
                    put("authCode",      data?.getStringExtra("AUTH_CODE")      ?: "")
                })
            } else {
                c.resolve(JSObject().apply {
                    put("approved", false)
                    put("error",    data?.getStringExtra("STATUS_MSG") ?: "Declined (status $status)")
                })
            }
        } else {
            c.resolve(JSObject().apply {
                put("approved", false)
                put("error",    "Payment cancelled")
            })
        }
    }

    /** Carbon terminal is always ready when the app is running on-device. */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().apply { put("connected", true) })
    }
}
