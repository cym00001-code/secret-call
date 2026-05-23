package com.secretroom.app

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        bridge?.webView?.evaluateJavascript("window.__SECRET_ROOM_NATIVE_PLATFORM = 'android';", null)
    }
}
