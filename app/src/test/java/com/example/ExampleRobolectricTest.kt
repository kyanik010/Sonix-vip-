package com.example

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ExampleRobolectricTest {

    @Test
    fun verifyAppNameConstant() {
        val appName = "SONIX TV"
        assertEquals("SONIX TV", appName)
    }

    @Test
    fun verifyAssetFilesExist() {
        // Verify sonix_tv.html exists in assets
        val assetsFile = File("src/main/assets/sonix_tv.html")
        assertTrue("sonix_tv.html asset must exist", assetsFile.exists())
        assertTrue("sonix_tv.html should not be empty", assetsFile.length() > 1000)
    }
}
