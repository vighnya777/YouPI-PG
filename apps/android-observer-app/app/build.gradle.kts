plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.youpi.observer"
    compileSdk = 34

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/java")
            java.exclude(
                "com/youpi/observer/ApiClient.java",
                "com/youpi/observer/BootReceiver.java",
                "com/youpi/observer/ForegroundService.java",
                "com/youpi/observer/MainActivity.java",
                "com/youpi/observer/PaymentNotificationListenerService.java",
                "com/youpi/observer/SmsReceiver.java"
            )
        }
    }

    defaultConfig {
        applicationId = "com.youpi.observer"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.zxing:core:3.5.3")
}
