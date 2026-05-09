# Forge 1.20.1 Fixture (CI only)

This is **not a mod project** and is not built or distributed. It exists solely
so the `patched-jars.yml` GitHub Actions workflow can run
`./gradlew setupDecompWorkspace` to materialize the patched Minecraft 1.20.1 +
Forge 47.4.0 JAR, which the patched-JAR test suite then exercises.

The Gradle wrapper is **not** committed here — CI installs Gradle via
`gradle/actions/setup-gradle` and invokes `gradle setupDecompWorkspace`
directly. If you need to run this locally, install Gradle 8.5 (or any
ForgeGradle 6.0-compatible version) and run `gradle setupDecompWorkspace`
from this directory.

For local invocation outside CI, prefer running the patched-JAR test suite
against a JAR you already have from your real ForgeGradle dev environment:

```
PATCHED_JAR_PATH=/path/to/your/patched.jar \
PATCHED_VERSION=1.20.1-forge-47.4.0 \
PATCHED_MC_VERSION=1.20.1 \
PATCHED_LOADER=forge \
npm run test:manual:patched
```
