package com.example

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.net.Uri
import android.util.Base64
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen awake during playback
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        try {
            val wv = WebView(this).apply {
                isFocusable = true
                isFocusableInTouchMode = true
                setBackgroundColor(0xFF0A0F14.toInt())

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    allowFileAccess = true
                    allowContentAccess = true
                    loadWithOverviewMode = true
                    useWideViewPort = true
                    builtInZoomControls = false
                    displayZoomControls = false
                    cacheMode = WebSettings.LOAD_DEFAULT
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                }

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val target = request?.url ?: return true
                        // Keep the JavaScript bridge confined to the bundled local app.
                        return target.scheme != "file" || target.host != null
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest?) {
                        request?.grant(request.resources)
                    }
                }

                addJavascriptInterface(WebAppInterface(this@MainActivity), "AndroidBridge")
            }

            webView = wv
            setContentView(wv)

            // Back button handling: routes back to Home or closes modals inside web app
            onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView?.evaluateJavascript(
                        "(function() { if (window.handleAndroidBack) { window.handleAndroidBack(); } else if (window.remoteNavigator) { window.remoteNavigator.handleBackAction(); } })()",
                        null
                    )
                }
            })

            // Load the standalone SONIX TV interface
            wv.loadUrl("file:///android_asset/sonix_tv.html")
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    class WebAppInterface(private val activity: MainActivity) {
        private val preferences by lazy {
            activity.getSharedPreferences("sonix_iptv_secure", Context.MODE_PRIVATE)
        }
        private val keyAlias = "sonix_iptv_credentials_key"

        @android.webkit.JavascriptInterface
        fun closeApp() {
            activity.runOnUiThread { activity.finish() }
        }

        @android.webkit.JavascriptInterface
        fun fetchIptv(address: String, requestId: String) {
            if (!requestId.matches(Regex("[0-9]{1,12}"))) return
            Thread {
                var connection: HttpURLConnection? = null
                val result = try {
                    val parsed = Uri.parse(address)
                    require(parsed.scheme == "http" || parsed.scheme == "https")
                    require(!parsed.host.isNullOrBlank())
                    connection = (URL(address).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 15000
                        readTimeout = 20000
                        instanceFollowRedirects = true
                        setRequestProperty("Accept", "application/json")
                        setRequestProperty("User-Agent", "SONIX-TV/1.0")
                    }
                    val status = connection.responseCode
                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val output = ByteArrayOutputStream()
                    stream?.use { input ->
                        val buffer = ByteArray(8192)
                        var total = 0
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 20 * 1024 * 1024) { "IPTV response too large" }
                            output.write(buffer, 0, count)
                        }
                    }
                    JSONObject()
                        .put("ok", status in 200..299)
                        .put("status", status)
                        .put("body", output.toString(Charsets.UTF_8.name()))
                        .toString()
                } catch (_: Exception) {
                    JSONObject().put("ok", false).put("status", 0).put("body", "").toString()
                } finally {
                    connection?.disconnect()
                }
                activity.runOnUiThread {
                    val callback = "window.__onIptvResponse && window.__onIptvResponse(" +
                        JSONObject.quote(requestId) + "," + JSONObject.quote(result) + ")"
                    activity.webView?.evaluateJavascript(callback, null)
                }
            }.start()
        }

        @android.webkit.JavascriptInterface
        fun saveIptvConfig(server: String, username: String, password: String): Boolean {
            return try {
                require(server.startsWith("http://") || server.startsWith("https://"))
                require(username.isNotBlank() && password.isNotBlank())
                val payload = JSONObject()
                    .put("server", server)
                    .put("username", username)
                    .put("password", password)
                    .toString()
                    .toByteArray(Charsets.UTF_8)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
                val encrypted = cipher.doFinal(payload)
                val packed = cipher.iv + encrypted
                preferences.edit()
                    .putString("credentials", Base64.encodeToString(packed, Base64.NO_WRAP))
                    .apply()
                true
            } catch (_: Exception) {
                false
            }
        }

        @android.webkit.JavascriptInterface
        fun loadIptvConfig(): String {
            return try {
                val encoded = preferences.getString("credentials", null) ?: return "{}"
                val packed = Base64.decode(encoded, Base64.NO_WRAP)
                require(packed.size > 12)
                val iv = packed.copyOfRange(0, 12)
                val ciphertext = packed.copyOfRange(12, packed.size)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
                String(cipher.doFinal(ciphertext), Charsets.UTF_8)
            } catch (_: Exception) {
                "{}"
            }
        }

        private fun getOrCreateKey(): SecretKey {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val existing = keyStore.getKey(keyAlias, null) as? SecretKey
            if (existing != null) return existing
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            return generator.generateKey()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val wv = webView ?: return super.onKeyDown(keyCode, event)
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> {
                dispatchWebKey("ArrowUp")
                return true
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                dispatchWebKey("ArrowDown")
                return true
            }
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                dispatchWebKey("ArrowLeft")
                return true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                dispatchWebKey("ArrowRight")
                return true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                dispatchWebKey("Enter")
                return true
            }
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                wv.evaluateJavascript(
                    "(function() { if (window.handleAndroidBack) { window.handleAndroidBack(); } else if (window.remoteNavigator) { window.remoteNavigator.handleBackAction(); } })()",
                    null
                )
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun dispatchWebKey(keyName: String) {
        val js = """
            (function() {
                var event = new KeyboardEvent('keydown', {
                    key: '$keyName',
                    code: '$keyName',
                    bubbles: true,
                    cancelable: true
                });
                window.dispatchEvent(event);
            })();
        """.trimIndent()
        webView?.evaluateJavascript(js, null)
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        webView?.evaluateJavascript(
            "(function() { if (typeof window.ensureHomeScreen === 'function') { window.ensureHomeScreen(); } })()",
            null
        )
    }

    override fun onPause() {
        super.onPause()
        webView?.evaluateJavascript(
            "(function() { if (window.videoPlaybackController) { window.videoPlaybackController.pause(); } })()",
            null
        )
        webView?.onPause()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
