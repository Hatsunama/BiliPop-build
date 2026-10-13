package app.bilipop.translation

import android.app.Activity
import android.os.Bundle
import android.widget.FrameLayout

// Packaged only in the library's instrumentation APK, never in the application.
class BackgroundTestActivity : Activity() {
  lateinit var host: FrameLayout
    private set

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    host = FrameLayout(this)
    setContentView(host)
  }
}
