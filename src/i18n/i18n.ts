/**
 * A minimal English / Arabic layer for the Branch POS.
 *
 * Deliberately tiny and dependency-free: the backend already returns an Arabic
 * name (`nameAr`) alongside every English one for branches, categories,
 * products, variants and add-ons, so most of the screen localises just by
 * picking the right field. This module covers the fixed UI chrome — nav,
 * headings, buttons — and the direction flip. The pure helpers are unit-tested.
 */

export type Lang = 'en' | 'ar';

/** Reading direction for a language — drives `dir` on the app container. */
export function dirFor(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Picks the localised name, falling back to English when an Arabic name is
 * missing (a half-translated catalog must never render a blank label).
 */
export function pickName(
  lang: Lang,
  names: { name: string; nameAr?: string | null },
): string {
  if (lang === 'ar' && names.nameAr) {
    return names.nameAr;
  }
  return names.name;
}

/** The fixed UI strings, by key, per language. */
const DICTIONARY: Record<string, { en: string; ar: string }> = {
  brand: { en: 'Rami Broast', ar: 'رامي' },
  branchPos: { en: 'Branch POS', ar: 'نقطة بيع الفرع' },
  yourBranchOnly: { en: 'You only ever see this branch.', ar: 'أنت ترى هذا الفرع فقط.' },
  signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
  // Navigation
  navOrders: { en: 'Orders', ar: 'الطلبات' },
  navNewOrder: { en: 'New order', ar: 'طلب جديد' },
  navDeliveries: { en: 'Deliveries', ar: 'التوصيل' },
  navLookup: { en: 'Find order', ar: 'بحث عن طلب' },
  navMenu: { en: 'Menu', ar: 'القائمة' },
  navPrint: { en: 'Print settings', ar: 'إعدادات الطباعة' },
  navReceipt: { en: 'Receipt', ar: 'الإيصال' },
  navReports: { en: 'Reports', ar: 'التقارير' },

  // --- Reports (daily + custom range) ----------------------------------------
  reportsTitle: { en: 'Reports', ar: 'التقارير' },
  reportsHint: {
    en: "Your branch's own figures. Every number is the server's, over the days you pick.",
    ar: 'أرقام فرعك وحده. كل رقم يأتي من الخادم، عن الأيام التي تختارها.',
  },
  reportsToday: { en: 'Today', ar: 'اليوم' },
  reportsYesterday: { en: 'Yesterday', ar: 'أمس' },
  reportsLast7: { en: 'Last 7 days', ar: 'آخر ٧ أيام' },
  reportsThisMonth: { en: 'This month', ar: 'هذا الشهر' },
  reportsCustom: { en: 'Custom range', ar: 'فترة مخصصة' },
  reportsFrom: { en: 'From', ar: 'من' },
  reportsTo: { en: 'To', ar: 'إلى' },
  reportsBadRange: {
    en: 'Pick a start day that is not after the end day.',
    ar: 'اختر يوم بداية لا يأتي بعد يوم النهاية.',
  },
  reportsDays: { en: '{n} days', ar: '{n} أيام' },
  reportsOneDay: { en: '1 day', ar: 'يوم واحد' },
  reportsLocalDays: {
    en: 'Days are counted by this branch’s own clock, midnight to midnight.',
    ar: 'تُحسب الأيام بساعة الفرع نفسه، من منتصف الليل إلى منتصف الليل.',
  },
  reportsRefresh: { en: 'Refresh', ar: 'تحديث' },
  reportsPrint: { en: 'Print this report', ar: 'اطبع هذا التقرير' },
  reportsPrinted: { en: 'Sent to the printer.', ar: 'أُرسل إلى الطابعة.' },
  reportsPrintFailed: { en: 'The printer did not take the job.', ar: 'لم تقبل الطابعة المهمة.' },

  // Sales
  reportsRealised: { en: 'Realised sales', ar: 'المبيعات المحققة' },
  reportsRealisedHint: {
    en: 'Confirmed orders onward. Cancelled and unpaid orders are counted in the status list below, never in this revenue.',
    ar: 'الطلبات المؤكدة وما بعدها. الطلبات الملغاة وغير المدفوعة تُحسب في قائمة الحالات أدناه، ولا تدخل في هذه الإيرادات أبدًا.',
  },
  reportsOrders: { en: 'Orders', ar: 'الطلبات' },
  reportsSubtotal: { en: 'Items subtotal', ar: 'مجموع الأصناف' },
  reportsDiscounts: { en: 'Discounts', ar: 'الخصومات' },
  reportsDeliveryFees: { en: 'Delivery fees', ar: 'رسوم التوصيل' },
  reportsCharges: { en: 'Charges', ar: 'الرسوم' },
  reportsTotal: { en: 'Total taken', ar: 'الإجمالي المحصّل' },
  reportsVatIncluded: { en: 'VAT included in the total', ar: 'الضريبة المضمّنة في الإجمالي' },
  reportsVatInclusiveNote: {
    en: 'Prices include VAT, so this is how much of the total is tax — it does not add to it.',
    ar: 'الأسعار تشمل الضريبة، فهذا هو مقدار الضريبة داخل الإجمالي ولا يُضاف إليه.',
  },
  reportsByStatus: { en: 'Orders by status', ar: 'الطلبات حسب الحالة' },
  reportsChargeBreakdown: { en: 'Charges collected', ar: 'الرسوم المحصّلة' },
  reportsCount: { en: 'Count', ar: 'العدد' },
  // A table column, deliberately not `reportsTotal`: that is the headline
  // figure's label, and one word naming both the day's takings and a column of
  // per-row sums is the kind of ambiguity somebody reads a row as the total by.
  reportsAmount: { en: 'Amount', ar: 'المبلغ' },

  // Payments
  reportsPayments: { en: 'Payments', ar: 'المدفوعات' },
  reportsByMethod: { en: 'By method', ar: 'حسب طريقة الدفع' },
  reportsMethod: { en: 'Method', ar: 'الطريقة' },
  reportsStatus: { en: 'Status', ar: 'الحالة' },
  reportsCaptured: { en: 'Captured', ar: 'المحصّل' },
  reportsRefunded: { en: 'Refunded', ar: 'المُرجع' },
  reportsNetTaken: { en: 'Net taken', ar: 'الصافي المحصّل' },
  reportsCodPending: {
    en: 'Cash on delivery is captured when the driver hands the money over, so an order still out reads as pending here rather than as money taken.',
    ar: 'يُحصَّل الدفع عند التوصيل عندما يسلّم السائق المبلغ، لذا يظهر الطلب الذي لم يُسلَّم بعد كمعلّق هنا لا كمبلغ محصّل.',
  },

  // VAT
  reportsVat: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
  reportsVatRate: { en: 'Rate', ar: 'النسبة' },
  reportsTaxableBase: { en: 'Taxable base', ar: 'الوعاء الضريبي' },
  reportsTotalVat: { en: 'Total VAT', ar: 'إجمالي الضريبة' },
  reportsVatGross: {
    en: 'Gross output VAT. Refunds are never netted here — the restaurant nets them from its own invoicing records.',
    ar: 'ضريبة مخرجات إجمالية. لا تُخصم المبالغ المُرجعة هنا — يخصمها المطعم من سجلات فواتيره الخاصة.',
  },
  reportsNotTaxInvoice: {
    en: 'This is not a tax invoice. The restaurant issues its own.',
    ar: 'هذه ليست فاتورة ضريبية. يُصدر المطعم فواتيره بنفسه.',
  },

  // Timings
  reportsTimings: { en: 'Timings', ar: 'الأوقات' },
  reportsPrepTime: { en: 'Average prep time', ar: 'متوسط زمن التحضير' },
  reportsDeliveryTime: { en: 'Average delivery time', ar: 'متوسط زمن التوصيل' },
  reportsSamples: { en: 'from {n} orders', ar: 'من {n} طلبًا' },
  reportsNoSamples: {
    en: 'Nothing finished in this window, so there is no average to show.',
    ar: 'لم يكتمل شيء في هذه الفترة، فلا يوجد متوسط لعرضه.',
  },

  reportsEmpty: {
    en: 'No orders in these days. The figures below are all zero because nothing was sold, not because something failed to load.',
    ar: 'لا توجد طلبات في هذه الأيام. الأرقام أدناه أصفار لأنه لم يُبَع شيء، وليس لأن التحميل فشل.',
  },
  reportsNoRows: { en: 'Nothing in this window.', ar: 'لا يوجد شيء في هذه الفترة.' },

  // --- Receipt (the preview, on its own tab) ---------------------------------
  receiptTitle: { en: 'Receipt', ar: 'الإيصال' },
  receiptHint: {
    en: 'Exactly what your printer will produce. This is built by the same code that prints, so what you see here is what comes off the roll.',
    ar: 'ما ستطبعه الطابعة بالضبط. هذه المعاينة مبنية بنفس الكود الذي يطبع، فما تراه هنا هو ما يخرج من الورق.',
  },
  receiptTabDocket: { en: 'Customer receipt', ar: 'إيصال العميل' },
  receiptTabKitchen: { en: 'Kitchen ticket', ar: 'تذكرة المطبخ' },
  receiptRollYours: { en: 'your roll', ar: 'ورقك' },
  receiptColumns: { en: 'columns', ar: 'عمودًا' },
  receiptSample: {
    en: 'A sample order: a first-time customer, a stacked promotion and coupon, an item note.',
    ar: 'طلب نموذجي: عميل لأول مرة، عرض وكوبون معًا، وملاحظة على صنف.',
  },
  receiptPreviewLabel: { en: 'Receipt preview', ar: 'معاينة الإيصال' },
  receiptLogoAlt: { en: 'The logo as it will print', ar: 'الشعار كما سيُطبع' },
  receiptLogoUnavailable: {
    en: 'The logo could not be prepared on this machine. The receipt prints without it.',
    ar: 'تعذّر تجهيز الشعار على هذا الجهاز. سيُطبع الإيصال بدونه.',
  },
  receiptPrintSample: { en: 'Print this sample', ar: 'اطبع هذا النموذج' },
  receiptRefresh: { en: 'Refresh', ar: 'تحديث' },
  receiptFromServer: { en: 'Up to date with the server.', ar: 'محدَّث من الخادم.' },
  receiptFromCache: {
    en: 'Could not reach the server — showing the copy saved on this machine, which is what will print.',
    ar: 'تعذّر الوصول إلى الخادم — هذه النسخة المحفوظة على هذا الجهاز، وهي ما سيُطبع.',
  },
  receiptPrinted: { en: 'Sent to the printer.', ar: 'أُرسل إلى الطابعة.' },
  receiptPrintFailed: { en: 'The printer did not take the job.', ar: 'لم تقبل الطابعة المهمة.' },
  receiptInEffect: { en: 'What is set right now', ar: 'الإعدادات الحالية' },
  receiptLogoOn: { en: 'Logo prints, at {percent}% of the paper width.', ar: 'يُطبع الشعار بعرض {percent}% من عرض الورق.' },
  receiptLogoOff: { en: 'The logo does not print.', ar: 'لا يُطبع الشعار.' },
  receiptAllSections: { en: 'Every section prints.', ar: 'تُطبع كل الأقسام.' },
  receiptSectionsOff: { en: 'Switched off:', ar: 'موقوف:' },
  receiptOwnerOnly: {
    en: 'The layout, the logo, the restaurant name and the footer are set by the owner in the admin panel.',
    ar: 'التنسيق والشعار واسم المطعم وسطر التذييل يحدّدها المالك من لوحة الإدارة.',
  },
  receiptBranchSettings: { en: "This branch's own settings", ar: 'إعدادات هذا الفرع' },
  receiptBranchHint: {
    en: 'These two are yours to set. Everything else on the receipt is the owner\u2019s.',
    ar: 'هذان الإعدادان من حق الفرع. أما بقية الإيصال فهي من حق المالك.',
  },
  receiptThankYou: { en: 'Thank-you lines', ar: 'سطور الشكر' },
  receiptOneLineEach: { en: 'One line per row.', ar: 'سطر واحد في كل صف.' },
  receiptReadyTime: { en: 'Ready time', ar: 'وقت الجهوزية' },
  receiptReadyTimeHint: {
    en: 'How long your kitchen takes. This is the window printed on the customer\u2019s receipt.',
    ar: 'كم يستغرق مطبخك. هذه هي المدة المطبوعة على إيصال العميل.',
  },
  receiptSmallOrder: { en: 'Small order (minutes)', ar: 'طلب صغير (دقائق)' },
  receiptLargeOrder: { en: 'Large order (minutes)', ar: 'طلب كبير (دقائق)' },
  receiptFrom: { en: 'from', ar: 'من' },
  receiptTo: { en: 'to', ar: 'إلى' },
  receiptDeliveryExtra: { en: 'Extra for delivery (minutes)', ar: 'إضافي للتوصيل (دقائق)' },
  receiptLargeThreshold: { en: 'Large above (SAR)', ar: 'كبير فوق (ريال)' },
  receiptSave: { en: 'Save', ar: 'حفظ' },
  receiptReset: { en: "Back to the owner's settings", ar: 'العودة إلى إعدادات المالك' },
  receiptUnsaved: { en: 'Unsaved changes', ar: 'تغييرات غير محفوظة' },
  receiptSaved: { en: 'Saved.', ar: 'تم الحفظ.' },
  receiptNotSaved: { en: 'Not saved', ar: 'لم يُحفظ' },
  receiptReadOnly: {
    en: 'This account can see the receipt but not change it. A branch manager account can set the ready time and the thank-you lines.',
    ar: 'هذا الحساب يرى الإيصال ولا يعدّله. حساب مدير الفرع يمكنه ضبط وقت الجهوزية وسطور الشكر.',
  },
  receiptHasOverride: {
    en: 'This branch is using its own ready time and thank-you lines.',
    ar: 'يستخدم هذا الفرع وقت جهوزية وسطور شكر خاصة به.',
  },
  rsLogo: { en: 'logo', ar: 'الشعار' },
  rsBrand: { en: 'restaurant name', ar: 'اسم المطعم' },
  rsOrderType: { en: 'order type', ar: 'نوع الطلب' },
  rsOrderMeta: { en: 'order number and time', ar: 'رقم الطلب ووقته' },
  rsCustomer: { en: 'customer', ar: 'العميل' },
  rsReadyTime: { en: 'ready time', ar: 'وقت الجهوزية' },
  rsItems: { en: 'items', ar: 'الأصناف' },
  rsTotals: { en: 'totals', ar: 'الإجماليات' },
  rsReference: { en: 'reference number', ar: 'الرقم المرجعي' },
  rsThankYou: { en: 'thank-you', ar: 'الشكر' },

  // --- The printer setup guide ---------------------------------------------
  // Written for the person standing at the counter on opening day, not for
  // whoever wrote the code: every line says what to do or what to look at, and
  // the Arabic is the one a cashier actually reads, not a transliteration.
  guideBackToOrders: { en: 'Back to orders', ar: 'العودة إلى الطلبات' },
  guideAdvanced: { en: 'Advanced settings', ar: 'إعدادات متقدمة' },
  guideTitle: { en: 'Set up the printer', ar: 'إعداد الطابعة' },
  guideIntro: {
    en: 'Five steps, once. Work down the list — the ones this screen can check turn green by themselves.',
    ar: 'خمس خطوات، مرة واحدة. اتبع القائمة — الخطوات التي يمكن لهذه الشاشة التحقق منها تتحول إلى الأخضر تلقائيًا.',
  },
  guideStepDone: { en: 'Done', ar: 'تم' },
  guideStepCheck: { en: 'Check this', ar: 'تحقق من هذا' },
  guideStepNow: { en: 'Do this now', ar: 'افعل هذا الآن' },
  guideStepLater: { en: 'Optional', ar: 'اختياري' },
  guideStepWaiting: { en: 'Next', ar: 'التالي' },

  guideStep1: { en: 'Plug the printer in', ar: 'وصّل الطابعة' },
  guideStep1Body: {
    en: 'Power cable in, USB cable into this computer, and a roll of paper loaded with the paper coming off the top. Switch it on — the light on the printer should be steady, not blinking.',
    ar: 'وصّل كابل الكهرباء، وكابل USB بهذا الجهاز، وضع لفة ورق بحيث يخرج الورق من الأعلى. شغّل الطابعة — يجب أن يكون ضوءها ثابتًا وليس وامضًا.',
  },
  guideStep1Note: {
    en: 'A blinking light usually means the paper is in the wrong way round or the cover is not shut.',
    ar: 'الضوء الوامض يعني عادةً أن الورق مقلوب أو أن الغطاء غير مغلق.',
  },

  guideStep2: { en: 'Start QZ Tray', ar: 'شغّل برنامج QZ Tray' },
  guideStep2Body: {
    en: 'QZ Tray is the small free program that lets this screen reach the printer. If it is already installed, look for its icon near the clock and open it.',
    ar: 'QZ Tray هو برنامج صغير مجاني يتيح لهذه الشاشة الوصول إلى الطابعة. إذا كان مثبتًا بالفعل، ابحث عن أيقونته بجوار الساعة وافتحه.',
  },
  guideStep2Running: { en: 'QZ Tray is running on this computer.', ar: 'برنامج QZ Tray يعمل على هذا الجهاز.' },
  guideStep2Missing: { en: 'QZ Tray is not running on this computer.', ar: 'برنامج QZ Tray لا يعمل على هذا الجهاز.' },
  guideGetQz: { en: 'Get QZ Tray', ar: 'تحميل QZ Tray' },
  guideCheckAgain: { en: 'Check again', ar: 'تحقق مرة أخرى' },

  guideStep3: { en: 'Choose the printer', ar: 'اختر الطابعة' },
  guideStep3Body: {
    en: 'We look at what this computer has and pick the receipt printer. If the wrong one is chosen, pick yours from the list.',
    ar: 'نبحث في الطابعات المتصلة بهذا الجهاز ونختار طابعة الفواتير. إذا اختير الجهاز الخطأ، اختر طابعتك من القائمة.',
  },
  guideStep3Chosen: { en: 'Printing to {name}.', ar: 'الطباعة إلى {name}.' },
  guideChooseAnother: { en: 'Use a different printer', ar: 'استخدم طابعة أخرى' },
  guidePickPrinter: { en: 'Pick the receipt printer:', ar: 'اختر طابعة الفواتير:' },
  guideNoPrinters: {
    en: 'This computer reports no printers at all. Check the USB cable, then press Check again.',
    ar: 'لا يوجد أي طابعة على هذا الجهاز. تحقق من كابل USB ثم اضغط تحقق مرة أخرى.',
  },

  guideStep4: { en: 'Print a test and look at it', ar: 'اطبع تجربة وانظر إليها' },
  guideTestFailed: { en: 'The printer did not take the job:', ar: 'لم تقبل الطابعة المهمة:' },
  guideWhyNoPrint: {
    en: 'Nothing will print until the steps above are green. This is what is stopping it right now:',
    ar: 'لن تتم أي طباعة حتى تصبح الخطوات أعلاه خضراء. هذا ما يمنعها الآن:',
  },
  guideBlockedNoQz: {
    en: 'QZ Tray is not running on this computer (step 2).',
    ar: 'برنامج QZ Tray لا يعمل على هذا الجهاز (الخطوة 2).',
  },
  guideBlockedNoPrinter: {
    en: 'No printer has been chosen yet (step 3).',
    ar: 'لم يتم اختيار طابعة بعد (الخطوة 3).',
  },
  guideBlockedNoPrintersFound: {
    en: 'This computer reports no printers at all — check the USB cable and that the printer is switched on (step 1).',
    ar: 'لا يرى هذا الجهاز أي طابعة — تحقق من كابل USB ومن أن الطابعة مشغّلة (الخطوة 1).',
  },
  guideStep4Body: {
    en: 'A test receipt comes out of the printer. Pick up the paper and answer honestly — this is the only step that needs your eyes.',
    ar: 'ستخرج فاتورة تجريبية من الطابعة. التقط الورقة وأجب بصدق — هذه هي الخطوة الوحيدة التي تحتاج إلى نظرك.',
  },
  guideSending: { en: 'Sending a test print…', ar: 'جارٍ إرسال تجربة الطباعة…' },
  guidePrintTest: { en: 'Print a test', ar: 'اطبع تجربة' },
  guideLooksRight: { en: 'It looks right', ar: 'تبدو صحيحة' },
  guideRanOff: { en: 'The text ran off the edge', ar: 'النص خرج عن حافة الورق' },
  guideNothing: { en: 'Nothing came out', ar: 'لم يخرج شيء' },

  guideStep5: { en: 'Stop the “allow printing” question', ar: 'أوقف سؤال «السماح بالطباعة»' },
  guideStep5Body: {
    en: 'If QZ Tray asked you to allow printing, this computer needs the restaurant’s certificate once. Download the file and run it as administrator. It takes a few seconds.',
    ar: 'إذا طلب منك QZ Tray السماح بالطباعة، فهذا الجهاز يحتاج إلى شهادة المطعم مرة واحدة. نزّل الملف وشغّله كمسؤول. يستغرق ذلك ثوانٍ.',
  },
  guideStep5Windows: {
    en: 'Right-click the downloaded file and choose “Run with PowerShell” as an administrator.',
    ar: 'انقر بزر الفأرة الأيمن على الملف الذي نزّلته واختر «Run with PowerShell» كمسؤول.',
  },
  guideStep5Unix: {
    en: 'Open Terminal where the file downloaded and run: sudo sh install-printer-certificate.sh',
    ar: 'افتح Terminal في مكان الملف وشغّل: sudo sh install-printer-certificate.sh',
  },
  guideDownloadCertificate: { en: 'Download the certificate installer', ar: 'تنزيل مثبّت الشهادة' },
  guidePreparing: { en: 'Preparing…', ar: 'جارٍ التحضير…' },
  guideCertificateUnavailable: {
    en: 'The certificate is not available. Printing still works — QZ Tray will ask once each session.',
    ar: 'الشهادة غير متاحة. الطباعة تعمل على أي حال — سيسأل QZ Tray مرة واحدة في كل جلسة.',
  },
  guideSignedAlready: {
    en: 'Prints are signed on this computer. QZ Tray will not ask you to allow printing.',
    ar: 'عمليات الطباعة موقّعة على هذا الجهاز. لن يطلب منك QZ Tray السماح بالطباعة.',
  },

  guideReady: { en: 'The printer is ready.', ar: 'الطابعة جاهزة.' },
  guideReadyBody: {
    en: 'Orders will print from the board. You can come back to this screen at any time.',
    ar: 'ستُطبع الطلبات من الشاشة الرئيسية. يمكنك العودة إلى هذه الصفحة في أي وقت.',
  },
  guideStartOver: { en: 'Set it up again', ar: 'أعد الإعداد' },
  guideNeedHelp: {
    en: 'Still stuck? Tell the owner which step number you are on — that is the fastest way to get help.',
    ar: 'ما زلت متعثرًا؟ أخبر المالك برقم الخطوة التي توقفت عندها — هذه أسرع طريقة للحصول على المساعدة.',
  },
  // Order lookup
  lookupTitle: { en: 'Find an order', ar: 'البحث عن طلب' },
  lookupHint: {
    en: 'Search by reference, order number or customer phone.',
    ar: 'ابحث بالرقم المرجعي أو رقم الطلب أو جوال العميل.',
  },
  lookupPlaceholder: { en: 'e.g. 482913066571', ar: 'مثال: 482913066571' },
  search: { en: 'Search', ar: 'بحث' },
  noMatches: { en: 'No orders matched that search.', ar: 'لا توجد طلبات مطابقة لهذا البحث.' },
  recentOrders: { en: 'Recent orders', ar: 'أحدث الطلبات' },
  reprint: { en: 'Reprint docket', ar: 'إعادة طباعة الإيصال' },
  reprintKitchen: { en: 'Reprint kitchen ticket', ar: 'إعادة طباعة تذكرة المطبخ' },
  placed: { en: 'Placed', ar: 'وقت الطلب' },
  status: { en: 'Status', ar: 'الحالة' },
  // Menu availability
  menuTitle: { en: 'Menu availability', ar: 'توفر أصناف القائمة' },
  menuHint: {
    en: 'Turn an item off when the branch runs out. It stops being orderable here and in the customer app straight away.',
    ar: 'أوقف الصنف عند نفاده من الفرع. سيتوقف الطلب عليه هنا وفي تطبيق العميل فورًا.',
  },
  soldOut: { en: 'Sold out', ar: 'نفد' },
  available: { en: 'Available', ar: 'متوفر' },
  markSoldOut: { en: 'Mark sold out', ar: 'تحديد كنافد' },
  markAvailable: { en: 'Mark available', ar: 'إعادة التوفير' },
  soldOutFor: { en: 'Sold out for how long?', ar: 'نفد لمدة كم؟' },
  soldOutOneHour: { en: '1 hour', ar: 'ساعة' },
  soldOutTwoHours: { en: '2 hours', ar: 'ساعتان' },
  soldOutRestOfDay: { en: 'Rest of today', ar: 'بقية اليوم' },
  soldOutIndefinite: { en: 'Until I switch it back', ar: 'حتى أعيده' },
  backInMinutes: { en: 'Back on sale in', ar: 'يعود للبيع خلال' },
  minutesShort: { en: 'min', ar: 'دقيقة' },
  backLater: { en: 'Back on sale later today', ar: 'يعود للبيع لاحقًا اليوم' },
  offUntilSwitchedBack: { en: 'Off until someone switches it back', ar: 'موقوف حتى إعادته يدويًا' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  filterItems: { en: 'Filter items', ar: 'تصفية الأصناف' },
  couldNotSave: { en: 'Could not save. Try again.', ar: 'تعذّر الحفظ. حاول مرة أخرى.' },
  // Render-failure fallback
  errorTitle: { en: 'Something went wrong', ar: 'حدث خطأ ما' },
  errorBody: {
    en: 'This part of the app failed to display. Nothing you have saved is affected — orders and settings are unchanged.',
    ar: 'تعذّر عرض هذا الجزء من التطبيق. لم يتأثر أي شيء تم حفظه — الطلبات والإعدادات كما هي.',
  },
  tryAgain: { en: 'Try again', ar: 'حاول مرة أخرى' },
  reloadApp: { en: 'Reload the app', ar: 'إعادة تحميل التطبيق' },
  // Board
  newOrders: { en: 'New orders', ar: 'طلبات جديدة' },
  kitchenQueue: { en: 'Kitchen queue', ar: 'قائمة المطبخ' },
  noneWaiting: { en: 'No orders waiting to be accepted.', ar: 'لا توجد طلبات بانتظار القبول.' },
  nothingCooking: { en: 'Nothing cooking right now.', ar: 'لا يوجد شيء قيد التحضير الآن.' },
  acceptPrint: { en: 'Accept & print', ar: 'قبول وطباعة' },
  accept: { en: 'Accept', ar: 'قبول' },
  reject: { en: 'Reject', ar: 'رفض' },
  takeBack: { en: 'Take back', ar: 'سحب من السائق' },
  startPreparing: { en: 'Start preparing', ar: 'بدء التحضير' },
  markReady: { en: 'Mark ready', ar: 'تحديد كجاهز' },
  completePickup: { en: 'Complete pickup', ar: 'إتمام الاستلام' },
  awaitingDriver: { en: 'Awaiting driver', ar: 'بانتظار السائق' },
  kitchenTicket: { en: 'Kitchen ticket', ar: 'تذكرة المطبخ' },
  docket: { en: 'Docket', ar: 'إيصال' },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  couldNotLoad: { en: 'Could not load. Retry.', ar: 'تعذّر التحميل. أعد المحاولة.' },
  retry: { en: 'Retry', ar: 'إعادة المحاولة' },
  // Permission diagnosis — what a 403 actually means for this account.
  noRole: { en: 'no role assigned', ar: 'لا يوجد دور مُسند' },
  permsMissing: { en: 'This account is missing', ar: 'هذا الحساب ينقصه' },
  permsFix: {
    en: 'An owner can grant it in Admin → Users.',
    ar: 'يمكن للمالك منحه من لوحة الإدارة ← المستخدمون.',
  },
  permsLookRight: {
    en: 'This account holds every permission this screen needs, so re-assigning its role will not help — show this to the owner.',
    ar: 'هذا الحساب يملك كل الصلاحيات التي تحتاجها هذه الشاشة، لذا لن تُجدي إعادة إسناد الدور — أطلع المالك على هذه الرسالة.',
  },
  // New order
  newOrderTitle: { en: 'New counter order', ar: 'طلب جديد على الكاونتر' },
  menu: { en: 'Menu', ar: 'القائمة' },
  cart: { en: 'Cart', ar: 'السلة' },
  cartEmpty: { en: 'No items yet. Tap a menu item to add it.', ar: 'لا توجد أصناف بعد. اضغط على صنف لإضافته.' },
  customer: { en: 'Customer', ar: 'العميل' },
  phone: { en: 'Phone (E.164, e.g. +9665…)', ar: 'الهاتف (بصيغة E.164، مثال +9665…)' },
  name: { en: 'Name (optional)', ar: 'الاسم (اختياري)' },
  orderType: { en: 'Order type', ar: 'نوع الطلب' },
  pickup: { en: 'Pickup', ar: 'استلام' },
  delivery: { en: 'Delivery', ar: 'توصيل' },
  address: { en: 'Delivery address', ar: 'عنوان التوصيل' },
  addressLine1: { en: 'Street / building', ar: 'الشارع / المبنى' },
  addressCity: { en: 'City', ar: 'المدينة' },
  addressDistrict: { en: 'District (optional)', ar: 'الحي (اختياري)' },
  addressNotes: { en: 'Driver notes (optional)', ar: 'ملاحظات للسائق (اختياري)' },
  payment: { en: 'Payment', ar: 'الدفع' },
  cashNow: { en: 'Cash — paid now', ar: 'نقدًا — مدفوع الآن' },
  cashLater: { en: 'Cash — on collection', ar: 'نقدًا — عند الاستلام' },
  codPay: { en: 'Cash on delivery', ar: 'الدفع عند التوصيل' },
  orderNotes: { en: 'Kitchen note (optional)', ar: 'ملاحظة للمطبخ (اختياري)' },
  placeOrder: { en: 'Place order', ar: 'تأكيد الطلب' },
  placing: { en: 'Placing…', ar: 'جارٍ التأكيد…' },
  orderPlaced: { en: 'Order placed', ar: 'تم تأكيد الطلب' },
  reference: { en: 'Reference', ar: 'الرقم المرجعي' },
  addItems: { en: 'Add at least one item.', ar: 'أضف صنفًا واحدًا على الأقل.' },
  total: { en: 'Total', ar: 'الإجمالي' },
  remove: { en: 'Remove', ar: 'إزالة' },
  clear: { en: 'Clear', ar: 'مسح' },
  // Deliveries
  deliveriesTitle: { en: 'Deliveries', ar: 'التوصيل' },
  noDeliveries: { en: 'No deliveries for this branch yet.', ar: 'لا يوجد توصيل لهذا الفرع بعد.' },
  driver: { en: 'Driver', ar: 'السائق' },
  unassigned: { en: 'No driver yet', ar: 'لا يوجد سائق بعد' },
  assignDriver: { en: 'Assign driver', ar: 'إسناد سائق' },
  // "No drivers on shift" and "no drivers free" are different problems with
  // different answers — ring somebody, or wait — and the old single line said
  // neither. Now that a busy driver can take another drop, the list is empty
  // only when nobody is on shift at all, so the copy says that.
  noDriversOnShift: {
    en: 'No drivers are on shift right now.',
    ar: 'لا يوجد سائقون في المناوبة الآن.',
  },
  driverFree: { en: 'Free', ar: 'متاح' },
  driverOnAJob: { en: 'On a job', ar: 'في مهمة' },
  driverCarryingOne: { en: 'Carrying 1 delivery', ar: 'يحمل طلب توصيل واحد' },
  driverCarryingMany: { en: 'Carrying {n} deliveries', ar: 'يحمل {n} طلبات توصيل' },
  // Shown once a busy driver is picked, because handing a second drop to
  // somebody already riding is a decision, not a slip — but it is a real and
  // ordinary decision, so it confirms rather than refuses.
  stackConfirm: {
    en: 'Give this to a driver who is already out?',
    ar: 'إسناد هذا الطلب إلى سائق يعمل بالفعل؟',
  },
  stackConfirmYes: { en: 'Yes, assign', ar: 'نعم، أسند' },
  assign: { en: 'Assign', ar: 'إسناد' },
  couldNotAssign: { en: 'Could not assign the driver.', ar: 'تعذّر إسناد السائق.' },
  vehicle: { en: 'Vehicle', ar: 'المركبة' },
  // The board's own delivery hand-off. `awaitingDriver` above is the status
  // word; these are the act and its result, shown on the order card itself so
  // the counter never has to leave the board to dispatch a ready order.
  assignNow: { en: 'Assign driver', ar: 'إسناد سائق' },
  driverOnTheWay: { en: 'Driver assigned', ar: 'تم إسناد السائق' },
  openingDelivery: { en: 'Preparing the delivery…', ar: 'جارٍ تجهيز التوصيل…' },
  ownerSingleBranch: {
    en: 'This POS runs one branch. Showing your first assigned branch.',
    ar: 'نقطة البيع هذه تُشغّل فرعًا واحدًا. يتم عرض أول فرع مُسنَد إليك.',
  },
};

/**
 * Translates a fixed UI key. Unknown keys return the key itself, so a miss is
 * visible, not blank.
 *
 * `vars` fills `{name}` placeholders. Arabic and English put a number in
 * different places in a sentence, so the number has to be a slot inside each
 * translation rather than something the caller concatenates on — string
 * building at the call site produces "3 يحمل طلبات" in one of the two
 * languages and nobody who reads only the other ever sees it.
 */
export function translate(
  lang: Lang,
  key: keyof typeof DICTIONARY | string,
  vars?: Record<string, string | number>,
): string {
  const entry = DICTIONARY[key];
  if (!entry) {
    return key;
  }
  const text = lang === 'ar' ? entry.ar : entry.en;
  if (!vars) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type TranslateKey = keyof typeof DICTIONARY;
