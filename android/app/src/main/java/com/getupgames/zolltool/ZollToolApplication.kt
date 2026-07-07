package com.getupgames.zolltool

import android.app.Application
import com.sumup.reader.sdk.api.SumUpState

class ZollToolApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SumUpState.init(this)
    }
}
