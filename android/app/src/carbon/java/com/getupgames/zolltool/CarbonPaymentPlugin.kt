package com.getupgames.zolltool

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.mypos.smartsdk.Currency
import com.mypos.smartsdk.MyPOSAPI
import com.mypos.smartsdk.MyPOSPayment
import com.mypos.smartsdk.MyPOSUtil
import com.mypos.smartsdk.TransactionProcessingResult
import java.util.UUID

/**
 * On-device payment for ZollTool running ON a myPOS Carbon/Ultra smart terminal
 * ("carbon" flavor only), via the official myPOS Smart SDK.
 *
 * MyPOSAPI.openPaymentActivity hands the amount to the terminal's PCI-certified
 * payment core; the result comes back through MainActivity.onActivityResult,
 * routed here by PaymentSdks.handleActivityResult (same pattern as SumUp in the
 * full flavor). Card data never touches this app.
 */
@CapacitorPlugin(name = "CarbonPayment")
class CarbonPaymentPlugin : Plugin() {

    companion object {
        private const val PAYMENT_REQUEST_CODE = 4801

        private var pendingCall: PluginCall? = null

        /** Routed from MainActivity.onActivityResult via the flavor's PaymentSdks. */
        fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
            if (requestCode != PAYMENT_REQUEST_CODE) return false
            val call = pendingCall ?: return true
            pendingCall = null

            if (resultCode != android.app.Activity.RESULT_OK || data == null) {
                call.resolve(JSObject().apply {
                    put("approved", false)
                    put("error", "Payment cancelled")
                })
                return true
            }

            val status = data.getIntExtra("status", TransactionProcessingResult.TRANSACTION_FAILED)
            if (status == TransactionProcessingResult.TRANSACTION_SUCCESS) {
                call.resolve(JSObject().apply {
                    put("approved",      true)
                    // STAN uniquely identifies the transaction on the terminal;
                    // fall back to the auth code if absent.
                    put("transactionId", data.getStringExtra("STAN")
                        ?: data.getStringExtra("authorization_code") ?: "")
                    put("cardBrand",     data.getStringExtra("card_brand") ?: "")
                    put("authCode",      data.getStringExtra("authorization_code") ?: "")
                })
            } else {
                call.resolve(JSObject().apply {
                    put("approved", false)
                    put("error", data.getStringExtra("status_text") ?: "Declined (status $status)")
                })
            }
            return true
        }
    }

    @PluginMethod
    fun startPayment(call: PluginCall) {
        val amount   = call.getDouble("amount")   ?: run { call.reject("amount required"); return }
        val currency = call.getString("currency") ?: "EUR"
        if (pendingCall != null) { call.reject("Payment already in progress"); return }

        // Refuse unknown currencies rather than silently charging in EUR.
        val posCurrency = try {
            Currency.valueOf(currency.uppercase())
        } catch (_: IllegalArgumentException) {
            call.reject("Currency $currency is not supported by the terminal")
            return
        }

        val payment = MyPOSPayment.builder()
            .productAmount(amount)
            .currency(posCurrency)
            .foreignTransactionId(UUID.randomUUID().toString())
            // ZollTool records its own sales; the built-in printer stays quiet
            .printMerchantReceipt(MyPOSUtil.RECEIPT_OFF)
            .printCustomerReceipt(MyPOSUtil.RECEIPT_OFF)
            .build()

        pendingCall = call
        try {
            MyPOSAPI.openPaymentActivity(activity, payment, PAYMENT_REQUEST_CODE)
        } catch (e: Exception) {
            pendingCall = null
            call.reject("Payment app not available: ${e.message}")
        }
    }

    /** Connected = the myPOS payment core is present (i.e. we run on a myPOS device). */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val onMyPosDevice = try {
            activity.packageManager.getPackageInfo("com.mypos", 0)
            true
        } catch (_: Exception) {
            false
        }
        call.resolve(JSObject().apply {
            put("connected", onMyPosDevice)
            if (!onMyPosDevice) put("detail", "myPOS payment app not found")
        })
    }
}
