package com.example.model

data class Channel(
    val id: String,
    val number: Int,
    val name: String,
    val category: String,
    val categoryName: String,
    val logoText: String,
    val streamUrl: String,
    val epgTitle: String = "",
    val epgDesc: String = "",
    val epgNext: String = ""
)

data class Category(
    val id: String,
    val name: String,
    val count: Int
)

data class VodItem(
    val id: String,
    val title: String,
    val meta: String,
    val category: String,
    val isSeries: Boolean = false
)

data class DualAudioState(
    val isActive: Boolean = false,
    val sourceChannel: Channel? = null,
    val statusText: String = "متوقف",
    val delayMs: Int = 0
)

fun toArabicIndic(str: String): String {
    val indic = charArrayOf('٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩')
    val sb = StringBuilder()
    for (ch in str) {
        if (ch in '0'..'9') {
            sb.append(indic[ch - '0'])
        } else {
            sb.append(ch)
        }
    }
    return sb.toString()
}

object SonixData {
    // No bundled demo catalog. Content must be populated from the active IPTV provider.
    val categories: List<Category> = emptyList()
    val channels: List<Channel> = emptyList()
    val movies: List<VodItem> = emptyList()
    val series: List<VodItem> = emptyList()
}
