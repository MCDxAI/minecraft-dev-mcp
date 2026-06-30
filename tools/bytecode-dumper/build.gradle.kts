plugins {
    java
    id("com.gradleup.shadow") version "8.3.5"
}

group = "dev.minecraftdev"
version = "1.0.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.ow2.asm:asm:9.10.1")
    implementation("org.ow2.asm:asm-tree:9.10.1")
    // asm-util is NOT needed: we use the asm-tree ClassNode object model only.
}

tasks.shadowJar {
    archiveBaseName.set("bytecode-dumper")
    archiveClassifier.set("")
    manifest {
        attributes["Main-Class"] = "dev.minecraftdev.BytecodeDumper"
    }
}

tasks.build {
    dependsOn(tasks.shadowJar)
}
