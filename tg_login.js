const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

// === Настройки ===
const API_ID = 22482713; // замени на свой
const API_HASH = "76343050cd0b4d8e3cc95b9ceee667fe"; // замени на свой

async function login() {
    const client = new TelegramClient(
        new StringSession(""), // пустая сессия
        API_ID,
        API_HASH,
        {
            connectionRetries: 5,
        }
    );

    console.log("🔄 Подключение к Telegram...");

    await client.start({
        phoneNumber: async () => await input.text("Введите номер телефона: "),
        password: async () => await input.text("Введите 2FA пароль (если есть): "),
        phoneCode: async () => await input.text("Введите код из Telegram: "),
        onError: (err) => console.error(err),
    });

    const self = await client.getMe();
    const sessionString = client.session.save();

    console.log("\n✅ Вы успешно вошли!");
    console.log("👤 Имя пользователя:", self.username || "Нет");
    console.log("🆔 ID пользователя:", self.id);
    console.log("\n🔗 Строка сессии (сохрани её):");
    console.log(sessionString);

    // Сохранение в файл (опционально)
    const fs = require("fs");
    const accountsFile = "accounts.json";

    let accounts = [];
    if (fs.existsSync(accountsFile)) {
        accounts = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    }

    const newAccountId = accounts.length ? Math.max(...accounts.map(a => a.id)) + 1 : 1;

    accounts.push({
        id: newAccountId,
        session: sessionString,
    });

    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
    console.log(`\n💾 Аккаунт сохранён в ${accountsFile} под ID: ${newAccountId}`);
}

login();