# Rules R8 needs that the libraries themselves do not ship.
#
# Read by the release build through `proguardFiles` in build.gradle.kts.
# tests/unit/android-shrinking.test.ts pins both this file and that wiring.

# Room creates each database's generated `_Impl` class by reflection, through
# its no-argument constructor. The ads SDK brings in WorkManager 2.7.0, which
# is built on Room 2.2.5, and that Room's own rule is only
# `-keep class * extends androidx.room.RoomDatabase`. Under AGP 9 a bare
# `-keep class` no longer keeps the default constructor, so R8 removed it from
# `WorkDatabase_Impl`. WorkManager starts with the process, before any
# activity, so the first store build (1.0.0+1) died on open with
# "Failed to create an instance of androidx.work.impl.WorkDatabase".
-keep class * extends androidx.room.RoomDatabase { <init>(); }
