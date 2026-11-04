package com.example.model

data class Channel(
    val id: String,
    val number: Int,
    val name: String,
    val category: String,
    val categoryName: String,
    val logoText: String,
    val streamUrl: String,
    val epgTitle: String = "بث مباشر - تغطية حصرية",
    val epgDesc: String = "نقل مباشر لأقوى الأحداث الرياضية والبرامج التحليلية على مدار الساعة.",
    val epgNext: String = "حصاد اليوم وملخص المباريات"
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
    val categories = listOf(
        Category("cat-sports", "AR | الرياضة SPORTS", 18),
        Category("cat-bein-4k", "beIN SPORTS 4K 3840p", 4),
        Category("cat-bein-hd", "beIN SPORTS HD", 12),
        Category("cat-ssc", "SSC SPORTS HD", 8),
        Category("cat-news", "AR | الاخبار NEWS", 14),
        Category("cat-docs", "AR | الوثائقيات DOCS", 10),
        Category("cat-ent", "AR | ترفيه ومنوعات ENTERTAINMENT", 16),
        Category("cat-4k", "4K & 8K ULTRA HD", 6),
        Category("cat-events", "EVENT ONLY (أحداث حصرية)", 5),
        Category("cat-fav", "المفضلة (FAVORITES)", 0)
    )

    val channels = listOf(
        Channel(
            id = "ch-1",
            number = 1,
            name = "beIN SPORTS 1 HD",
            category = "cat-sports",
            categoryName = "AR | الرياضة SPORTS",
            logoText = "B1",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            epgTitle = "الاستوديو التحليلي - دوري أبطال أوروبا",
            epgDesc = "تغطية مباشرة لقمة مباريات الليلة مع نخبة من كبار المحللين الرياضيين.",
            epgNext = "حصاد الأهداف وملخص الجولة"
        ),
        Channel(
            id = "ch-2",
            number = 2,
            name = "beIN SPORTS 2 HD",
            category = "cat-sports",
            categoryName = "AR | الرياضة SPORTS",
            logoText = "B2",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
            epgTitle = "الدوري الإنجليزي الممتاز - مباشر",
            epgDesc = "مباراة القمة في الدوري الإنجليزي الممتاز بتعليق عربي حصري.",
            epgNext = "عالم الدوري الإنجليزي"
        ),
        Channel(
            id = "ch-3",
            number = 3,
            name = "beIN SPORTS 3 HD",
            category = "cat-sports",
            categoryName = "AR | الرياضة SPORTS",
            logoText = "B3",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
            epgTitle = "الدوري الإسباني - لا ليغا",
            epgDesc = "مواجهة الجولة في الليغا الإسبانية مع استوديو تحليلي من مدريد.",
            epgNext = "أهداف الجولة الإسبانية"
        ),
        Channel(
            id = "ch-4",
            number = 4,
            name = "beIN SPORTS 4K 3840p",
            category = "cat-bein-4k",
            categoryName = "beIN SPORTS 4K 3840p",
            logoText = "4K",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
            epgTitle = "البث الفائق 4K - قمة الأسبوع",
            epgDesc = "أعلى دقة تصوير 3840p مع صوت دولبي محيطي نقي وتقنية HDR.",
            epgNext = "ملخصات 4K فائقة الوضوح"
        ),
        Channel(
            id = "ch-5",
            number = 5,
            name = "SSC 1 SPORTS HD",
            category = "cat-ssc",
            categoryName = "SSC SPORTS HD",
            logoText = "SSC",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
            epgTitle = "دوري روشن السعودي للمحترفين",
            epgDesc = "مباراة الجولة بين فريقي الهلال والنصر في ديربي الرياض.",
            epgNext = "برنامج برا 18"
        ),
        Channel(
            id = "ch-6",
            number = 6,
            name = "AR | الجزيرة الاخبارية NEWS",
            category = "cat-news",
            categoryName = "AR | الاخبار NEWS",
            logoText = "JAZ",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
            epgTitle = "نشرة الأخبار الرئيسية - منتصف اليوم",
            epgDesc = "متابعة شاملة لآخر التطورات السياسية في الشرق الأوسط والعالم.",
            epgNext = "ما وراء الخبر"
        ),
        Channel(
            id = "ch-7",
            number = 7,
            name = "AR | العربية الحدث NEWS",
            category = "cat-news",
            categoryName = "AR | الاخبار NEWS",
            logoText = "ARB",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
            epgTitle = "تغطية إخبارية مستمرة على مدار الساعة",
            epgDesc = "تقارير ميدانية ومقابلات مباشرة مع كبار المحللين السياسيين.",
            epgNext = "الشارع الدبلوماسي"
        ),
        Channel(
            id = "ch-8",
            number = 8,
            name = "AR | ناشيونال جيوغرافيك ابوظبي DOCS",
            category = "cat-docs",
            categoryName = "AR | الوثائقيات DOCS",
            logoText = "GEO",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
            epgTitle = "أسرار الطبيعة - المفترسات الكبرى",
            epgDesc = "رحلة استكشافية في أعماق الغابات الاستوائية والحيوانات النادرة.",
            epgNext = "هندسة عبقرية"
        ),
        Channel(
            id = "ch-9",
            number = 9,
            name = "MBC 1 HD ENTERTAINMENT",
            category = "cat-ent",
            categoryName = "AR | ترفيه ومنوعات ENTERTAINMENT",
            logoText = "MBC",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
            epgTitle = "مساء الخير يا عرب",
            epgDesc = "برنامج المنوعات الترفيهي اليومي وفقرات النجوم والمشاهير.",
            epgNext = "صدى الملاعب"
        ),
        Channel(
            id = "ch-10",
            number = 10,
            name = "EVENT ONLY | البث المباشر للأحداث",
            category = "cat-events",
            categoryName = "EVENT ONLY (أحداث حصرية)",
            logoText = "EVT",
            streamUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackSeeTheWorld.mp4",
            epgTitle = "مباراة الكلاسيكو - بث مخصص بدون تقطيع",
            epgDesc = "خادم مخصص لقمة مباريات الأسبوع مع قنوات صوتية متعددة.",
            epgNext = "المؤتمر الصحفي للمدربين"
        )
    )

    val movies = listOf(
        VodItem("m-1", "The Dune Saga Part 2", "2024 • 4K HDR", "خيال علمي"),
        VodItem("m-2", "Gladiator II", "2024 • 4K Dolby", "أكشن وتاريخي"),
        VodItem("m-3", "Oppenheimer", "2023 • FHD 1080p", "سيرة ودراما"),
        VodItem("m-4", "Mission Impossible 7", "2023 • 4K HDR", "إثارة وحركة"),
        VodItem("m-5", "The Batman", "2022 • 4K HDR", "جريمة وتشويق")
    )

    val series = listOf(
        VodItem("s-1", "House of the Dragon", "الموسم 2 • 8 حلقات", "فانتازيا", true),
        VodItem("s-2", "The Last of Us", "الموسم 1 • 9 حلقات", "دراما وخيال", true),
        VodItem("s-3", "Stranger Things", "الموسم 4 • 9 حلقات", "غموض ورعب", true),
        VodItem("s-4", "Breaking Bad", "المواسم 1-5 • 62 حلقة", "جريمة ودراما", true)
    )
}
