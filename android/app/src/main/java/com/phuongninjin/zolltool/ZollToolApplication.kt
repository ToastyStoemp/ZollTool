package com.phuongninjin.zolltool

import android.app.Application

class ZollToolApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PaymentSdks.init(this)
    }
}
