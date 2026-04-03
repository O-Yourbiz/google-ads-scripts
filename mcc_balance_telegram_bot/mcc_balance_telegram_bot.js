/**
 * НАЛАШТУВАННЯ СКРИПТА
 */
var SPREADSHEET_URL = "ВАШЕ_ПОСИЛАННЯ_НА_ТАБЛИЦЮ";
var TELEGRAM_BOT_TOKEN = "ВАШ_ТОКЕН_БОТА"; 
var TELEGRAM_CHAT_ID = "ВАШ_ID_ЧАТУ";   

function main() {
  Logger.log("Запуск скрипта перевірки балансів...");
  var sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL).getActiveSheet();
  var data = sheet.getDataRange().getValues();
  
  // Припускаємо, що формат таблиці:
  // Рядок 1: Заголовки (наприклад, "Account ID", "Threshold")
  // Рядок 2+: ID акаунту (XXX-XXX-XXXX), Ліміт балансу
  var checkList = {};
  for (var i = 1; i < data.length; i++) {
    var accountId = cleanAccountId(data[i][0]);
    var threshold = parseFloat(data[i][1]);
    
    if (accountId && !isNaN(threshold)) {
      checkList[accountId] = threshold;
    }
  }
  
  var accountIds = Object.keys(checkList);
  if (accountIds.length === 0) {
    Logger.log("Не знайдено валідних акаунтів або порогів у таблиці. Закінчення роботи.");
    return;
  }
  
  var accountIterator = AdsManagerApp.accounts().withIds(accountIds).get();
  var alerts = [];
  
  while (accountIterator.hasNext()) {
    var account = accountIterator.next();
    AdsManagerApp.select(account);
    var customerId = cleanAccountId(account.getCustomerId());
    var accountName = account.getName() || customerId;
    var threshold = checkList[customerId];
    
    Logger.log("Перевірка акаунту: " + accountName + " (ID: " + customerId + "), Поріг: " + threshold);
    
    // GAQL-запит для отримання витрат та ліміту Account Budget
    var query = "SELECT account_budget.approved_spending_limit_micros, " +
                "account_budget.adjusted_spending_limit_micros, " +
                "account_budget.amount_served_micros " +
                "FROM account_budget WHERE account_budget.status = 'APPROVED'";
                
    var report = AdsApp.search(query);
    
    var foundBudget = false;
    var limit = 0;
    var spent = 0;
    
    while (report.hasNext()) {
      foundBudget = true;
      var row = report.next();
      var b = row.accountBudget;
      
      if (b) {
        var l = b.adjustedSpendingLimitMicros || b.approvedSpendingLimitMicros || 0;
        var s = b.amountServedMicros || 0;
        limit = l / 1000000;
        spent = s / 1000000;
      }
    }
    
    if (foundBudget) {
      var balance = limit - spent;
      var balanceWithVat = balance * 1.2; // додаємо ПДВ 20%
      
      Logger.log("  Ліміт: " + limit + ", Витрачено: " + spent + " | Поточний залишок з ПДВ: " + balanceWithVat);
      
      if (balanceWithVat <= threshold) {
        alerts.push(
          "⚠️ <b>Низький баланс!</b>\n" +
          "Акаунт: <code>" + accountName + "</code> (" + customerId + ")\n" +
          "Залишок (з ПДВ): <b>" + balanceWithVat.toFixed(2) + " грн</b>\n" +
          "Встановлений поріг: " + threshold + " грн"
        );
      }
    } else {
      if(threshold > 0) {
         alerts.push(
            "❓ <b>Помилка перевірки!</b>\n" +
            "Акаунт: <code>" + accountName + "</code> (" + customerId + ")\n" +
            "Не знайдено активного (APPROVED) бюджету (Account Budget)."
         );
      }
    }
  }
  
  if (alerts.length > 0) {
    Logger.log("Виявлено проблеми. Відправка повідомлення в Telegram...");
    var fullMessage = alerts.join("\n\n");
    sendTelegramMessage(fullMessage);
  } else {
    Logger.log("Усі акаунти мають баланс вище заданих порогів. Відправка не потрібна.");
  }
}

function cleanAccountId(id) {
  if (!id) return "";
  return id.toString().replace(/-/g, "").trim();
}

function sendTelegramMessage(text) {
  if (TELEGRAM_BOT_TOKEN === "ВАШ_ТОКЕН_БОТА" || TELEGRAM_CHAT_ID === "ВАШ_ID_ЧАТУ") {
    Logger.log("Помилка: Токен бота або ID чату не налаштовано!");
    return;
  }
  
  var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  var payload = {
    "chat_id": TELEGRAM_CHAT_ID,
    "text": text,
    "parse_mode": "HTML"
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };
  
  try {
    UrlFetchApp.fetch(url, options);
    Logger.log("Повідомлення успішно відправлено!");
  } catch (e) {
    Logger.log("Помилка відправки в Telegram: " + e.message);
  }
}
