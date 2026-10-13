package app.bilipop.translation

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.Choreographer
import android.view.View
import android.widget.FrameLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.hatsunama.refract.RefractBackgroundView
import expo.modules.kotlin.AppContext
import io.mockk.mockk
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android attachment, layout, and Choreographer; only unused AppContext is mocked. */
@RunWith(AndroidJUnit4::class)
class BackgroundMotionTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private lateinit var scenario: ActivityScenario<BackgroundTestActivity>
  private lateinit var view: BiliPopBackgroundView
  private lateinit var renderer: RefractBackgroundView

  @Before fun launchHost() {
    val intent = Intent(instrumentation.context, BackgroundTestActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    scenario = ActivityScenario.launch(intent)
    scenario.onActivity { activity ->
      view = BiliPopBackgroundView(activity, mockk<AppContext>(relaxed = true))
      // No React Native drawable/state exists in this host. Avoid Expo's optional RN
      // padding clipping path; ExpoView, its layout, and the renderer stay real.
      view.clipToPadding = false
      renderer = view.getChildAt(0) as RefractBackgroundView
    }
  }

  @After fun closeHost() {
    if (::scenario.isInitialized) scenario.close()
  }

  private fun attach(enabled: Boolean, width: Int = 240, height: Int = 360) {
    scenario.onActivity {
      view.setMotionEnabled(enabled)
      it.host.addView(view, FrameLayout.LayoutParams(width, height))
    }
    frames()
    scenario.onActivity { assertTrue("Real window attachment required", view.isAttachedToWindow) }
  }

  private fun resize(width: Int, height: Int) {
    scenario.onActivity {
      view.layoutParams = FrameLayout.LayoutParams(width, height)
      view.requestLayout()
    }
    frames()
    scenario.onActivity {
      assertEquals("Renderer must receive actual child layout", width, renderer.width)
      assertEquals(height, renderer.height)
    }
  }

  // Wait for actual display callbacks, not Thread.sleep or direct doFrame calls.
  private fun frames(count: Int = 5) {
    instrumentation.waitForIdleSync()
    val done = CountDownLatch(1)
    instrumentation.runOnMainSync {
      var remaining = count
      val callback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
          if (--remaining == 0) done.countDown()
          else Choreographer.getInstance().postFrameCallback(this)
        }
      }
      Choreographer.getInstance().postFrameCallback(callback)
    }
    assertTrue("Native frame callbacks timed out (setup failure, not motion regression)",
      done.await(5, TimeUnit.SECONDS))
    instrumentation.waitForIdleSync()
  }

  private fun field(name: String): Any = RefractBackgroundView::class.java
    .getDeclaredField(name).apply { isAccessible = true }.get(renderer)!!

  private fun assertStopped(reason: String) {
    var timeBefore = 0.0
    scenario.onActivity {
      assertFalse("$reason: renderer re-armed", renderer.isAnimating())
      assertEquals("$reason: callback still armed", false, field("choreographerAttached"))
      timeBefore = field("tSec") as Double
    }
    frames()
    scenario.onActivity {
      assertFalse("$reason: renderer restarted on later frames", renderer.isAnimating())
      assertEquals("$reason: callback restarted", false, field("choreographerAttached"))
      assertEquals("$reason: simulation advanced", timeBefore, field("tSec") as Double, 0.0)
    }
  }

  private fun assertRunning() {
    var timeBefore = 0.0
    scenario.onActivity {
      assertTrue(renderer.isAnimating())
      assertEquals(true, field("choreographerAttached"))
      timeBefore = field("tSec") as Double
    }
    frames()
    scenario.onActivity { assertTrue("Real frames must advance simulation", (field("tSec") as Double) > timeBefore) }
  }

  @Test fun falseProp_zeroSizeAttach_thenFirstNonzeroLayout_staysStopped() {
    attach(enabled = false, width = 0, height = 0)
    scenario.onActivity { assertEquals(0, renderer.width); assertEquals(0, renderer.height) }
    assertStopped("False prop after zero-size attachment and drained callbacks")
    resize(240, 360)
    assertStopped("False prop must survive first nonzero native layout")
  }

  @Test fun falseProp_ordinaryAttachment_staysStopped() {
    attach(enabled = false)
    assertStopped("False prop on ordinary attachment")
  }

  @Test fun explicitEnableDisable_controlsRealFrames() {
    attach(enabled = false)
    scenario.onActivity { view.setMotionEnabled(true) }
    frames()
    assertRunning()
    scenario.onActivity { view.setMotionEnabled(false) }
    assertStopped("Explicit disable")
    scenario.onActivity { view.setMotionEnabled(true) }
    frames()
    assertRunning()
  }

  @Test fun enabled_hideShow_stopsThenResumes() {
    attach(enabled = true)
    assertRunning()
    scenario.onActivity { view.visibility = View.INVISIBLE }
    frames()
    assertStopped("Invisible parent")
    scenario.onActivity { view.visibility = View.VISIBLE }
    frames()
    assertRunning()
  }

  @Test fun paused_hideShowAndDetachReattach_staysStopped() {
    attach(enabled = false)
    scenario.onActivity { view.visibility = View.GONE }
    frames()
    assertStopped("Paused hidden view")
    scenario.onActivity { view.visibility = View.VISIBLE }
    frames()
    assertStopped("Paused shown view")
    scenario.onActivity { it.host.removeView(view) }
    frames()
    assertStopped("Detached view")
    scenario.onActivity { it.host.addView(view, FrameLayout.LayoutParams(240, 360)) }
    frames()
    assertStopped("Paused reattachment")
  }

  @Test fun paused_orientationChangeAndResize_staysStopped() {
    attach(enabled = false)
    scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
    awaitOrientation(Configuration.ORIENTATION_PORTRAIT)
    resize(240, 360)
    assertStopped("Paused portrait")
    scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
    awaitOrientation(Configuration.ORIENTATION_LANDSCAPE)
    resize(360, 240)
    assertStopped("Paused landscape")
  }

  private fun awaitOrientation(expected: Int) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    var actual = Configuration.ORIENTATION_UNDEFINED
    do {
      frames(2)
      scenario.onActivity { actual = it.resources.configuration.orientation }
    } while (actual != expected && System.nanoTime() < deadline)
    assertEquals("Host did not rotate (setup failure)", expected, actual)
  }
}
