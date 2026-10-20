# ProGuard configuration for the Android observer app.
# This file is intentionally minimal: release builds use the default Android optimization
# rules and the app's Kotlin implementation is kept as the single source of truth.

# Keep app classes from being stripped if they are accessed reflectively or by Android framework.
-keep class com.youpi.observer.** { *; }
