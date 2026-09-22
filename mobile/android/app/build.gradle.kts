import java.util.Properties

// Firebase is configured per deployment, and there is no project yet (D-34).
// `google-services.json` is gitignored and absent, and applying the plugin
// without it fails the build outright — so the plugin is applied only when the
// file exists. Drop the file in and push starts working; leave it out and the
// app builds and runs exactly as before, with notifications switched off.
val googleServicesConfig = file("google-services.json")

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services") apply false
}

if (googleServicesConfig.exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle("MealAdda: no google-services.json — building without push notifications.")
}

// Upload signing.
//
// `key.properties` is gitignored and holds the passwords; the keystore itself
// lives outside the repo. Losing that file means never being able to publish an
// update to this app again — Play identifies an app by its signing key, and
// there is no recovery. Back it up somewhere that is not this machine.
//
// Absent, the release build falls back to debug signing so `flutter run
// --release` still works locally. Play Console refuses a debug-signed bundle,
// so that fallback can never reach a store by accident.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.mealadda.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications, which draws notifications
        // that arrive while the app is open (D-34) — FCM shows nothing then.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.mealadda.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("upload") {
            if (!keystoreProperties.isEmpty) {
                storeFile = keystoreProperties["storeFile"]?.let { file(it) }
                storePassword = keystoreProperties["storePassword"] as String?
                keyAlias = keystoreProperties["keyAlias"] as String?
                keyPassword = keystoreProperties["keyPassword"] as String?
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystoreProperties.isEmpty) {
                // Local release runs only. See the note above.
                signingConfigs.getByName("debug")
            } else {
                signingConfigs.getByName("upload")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    // flutter_local_notifications documents a Flutter crash on Android 12L and
    // above once desugaring is on, fixed by these. Included up front rather
    // than discovered on a student's phone.
    implementation("androidx.window:window:1.0.0")
    implementation("androidx.window:window-java:1.0.0")
}
