package app.bilipop.translation

import android.content.Context
import android.view.View
import android.view.ViewGroup.LayoutParams
import com.hatsunama.refract.RefractBackgroundView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

// Keep app lifecycle/accessibility policy outside the unchanged canonical renderer.
class BiliPopBackgroundView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val renderer = RefractBackgroundView(context)
  private var motionEnabled = true

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    isClickable = false
    isFocusable = false
    addView(renderer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setMotionEnabled(enabled: Boolean) {
    motionEnabled = enabled
    renderer.setAnimating(enabled && isAttachedToWindow && isShown && windowVisibility == VISIBLE)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { setMotionEnabled(motionEnabled) }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    // The canonical renderer can start itself on first nonzero child layout.
    setMotionEnabled(motionEnabled)
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    // May run during construction. Read current policy/visibility on execution,
    // rather than capturing a value that could outlive a pause or detachment.
    post { setMotionEnabled(motionEnabled) }
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    // Called by View construction before property initialization as well.
    post { setMotionEnabled(motionEnabled) }
  }
}

class BiliPopBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BiliPopBackground")
    View(BiliPopBackgroundView::class) {
      Prop("motionEnabled") { view: BiliPopBackgroundView, enabled: Boolean -> view.setMotionEnabled(enabled) }
    }
  }
}
