RCC Material Stocks V11.1

Windows + Docker Desktop

Login:
Username: admin
Password: Admin@123

Start:
1. Docker Desktop open रखें.
2. Start RCC Stocks V11.bat double click करें.
3. Browser में http://localhost:3000 खुलेगा.

Important:
- Database Docker named volume में रहता है; Windows File Sharing की जरूरत नहीं.
- पुराने database को delete/reset न करें.
- Current Stock में alert level नहीं दिखाया जाता.
- Material Items में केवल Material Name, Model Number और Unit (Nos/Bundle/Unit/Piece) master होता है.
- Stock Alert में Site + Material + Minimum Quantity set कर सकते हैं; Add/Edit/Delete उपलब्ध है.
- Minimum quantity से current stock कम होने पर STOCK ALERT आता है.
- Transaction Type: Available, Receive, Issue, Return, Damage, Transfer.
- Issue/Damage/Transfer तभी save होगा जब source site पर पर्याप्त available stock हो.
- Transfer में From और To दोनों अलग sites होंगे और From हमेशा source रहेगा.


=== ADMIN ACCESS MANAGEMENT UPDATE ===
Admin login के बाद User Management में:
1. Username और Password Admin खुद बनाता है.
2. Role चुनें: Engineer / Foreman / Store Keeper / Admin.
3. Assigned Site(s) सिर्फ Admin चुन सकता है.
4. Permissions: View, Add Stock/Entry, Issue, Transfer, Damage, Return.
5. Store Keeper को default रूप से View-only रखा गया है; Admin चाहे तो अतिरिक्त permission दे सकता है.
6. Non-admin user को केवल Admin द्वारा assigned sites दिखाई देंगी.
7. Backend भी permissions enforce करता है; सिर्फ menu छिपाना नहीं है.
8. Users, Audit Log, Backup और Site/Material/Supplier master changes Admin-only हैं.
