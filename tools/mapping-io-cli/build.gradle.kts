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
    maven("https://maven.fabricmc.net/")
}

dependencies {
    implementation("net.fabricmc:mapping-io:0.8.0")
}

tasks.shadowJar {
    archiveBaseName.set("mapping-io-cli")
    archiveClassifier.set("")
    manifest {
        attributes["Main-Class"] = "dev.minecraftdev.MappingIoCli"
    }
}

tasks.build {
    dependsOn(tasks.shadowJar)
}
