const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require('sharp');
const express = require("express");
const screenshotConfig = require("./screenshotConfig");

// Загрузка конфигурации аккаунтов
const ACCOUNTS = require("./accounts.json");

// Дефолтные значения
const DEFAULT_API_ID = ACCOUNTS[0]?.api_id || 22482713;
const DEFAULT_API_HASH = ACCOUNTS[0]?.api_hash || "76343050cd0b4d8e3cc95b9ceee667fe";

let clients = [];
const app = express();
const PORT = process.env.PORT || 3001;

// === Утилиты ===
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// === Парсинг ссылки ВК ===
function parseVkPostUrl(url) {
    const match = url.match(/vk\.com\/wall(-?\d+)_(\d+)/i);
    if (!match) return null;

    return {
        ownerId: match[1],
        postId: match[2],
        fullId: `${match[1]}_${match[2]}`,
    };
}

// === Генерация скриншота ===
async function generateScreenshot(url) {
    try {
        const apiKey = '4110c0';
        const { viewport, clip } = screenshotConfig;
        const apiUrl = `https://api.screenshotmachine.com?key=${apiKey}&url=${
            encodeURIComponent(url)
        }&dimension=${
            viewport.width
        }x${
            viewport.height
        }&device=desktop&format=jpg&delay=2000`;
        console.log(`📸 Делаем скриншот: ${url}`);
        
        const screenshotDir = path.resolve(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir);
        }

        const response = await axios.get(apiUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const outputPath = path.join(screenshotDir, `screenshot_${Date.now()}.jpg`);

        await sharp(response.data)
            .extract({
                left: Math.round(clip.x),
                top: Math.round(clip.y),
                width: Math.round(clip.width),
                height: Math.round(clip.height),
            })
            .toFile(outputPath);

        console.log(`✅ Готово! Скриншот сохранен: ${outputPath}`);
        return outputPath;

    } catch (err) {
        console.error('❌ Ошибка:', err.message);
        return null;
    }
}

// === Получение ID пользователя ВК ===
async function getVkUserId(vkToken) {
    try {
        const res = await axios.get("https://api.vk.com/method/users.get", {
            params: {
                v: "5.199",
                access_token: vkToken,
            },
        });

        const user = res.data.response?.[0];
        if (!user) throw new Error("❌ Не удалось получить ID пользователя ВК");

        return Math.abs(user.id);
    } catch (err) {
        console.error("❌ Ошибка получения ID из ВК:", err.message);
        return null;
    }
}

// === Инициализация клиента ===
async function initClient(accountConfig) {
    try {
        const client = new TelegramClient(
            new StringSession(accountConfig.session),
            accountConfig.api_id || DEFAULT_API_ID,
            accountConfig.api_hash || DEFAULT_API_HASH,
            { connectionRetries: 5 }
        );

        await client.start({
            phoneNumber: () => Promise.resolve(""),
            password: () => Promise.resolve(""),
            phoneCode: () => Promise.resolve(""),
            onError: (err) => console.log(err),
        });

        if (!(await client.isUserAuthorized())) {
            console.warn(`⚠️ Аккаунт ${accountConfig.id} не авторизован`);
            return null;
        }

        const self = await client.getMe();
        console.log(`✅ Аккаунт ${accountConfig.id} (${self.username}) подключен`);

        // Получаем VK ID если не указан
        let vkUserId = accountConfig.vk_user_id;
        if (!vkUserId && accountConfig.vk_token) {
            vkUserId = await getVkUserId(accountConfig.vk_token);
        }

        return {
            id: accountConfig.id,
            client,
            username: self.username,
            chat_id: accountConfig.chat_id,
            vk_user_id: vkUserId,
            api_id: accountConfig.api_id || DEFAULT_API_ID,
            api_hash: accountConfig.api_hash || DEFAULT_API_HASH
        };

    } catch (err) {
        console.error(`❌ Ошибка инициализации аккаунта ${accountConfig.id}:`, err.message);
        return null;
    }
}

// === Проверка доступа к чату ===
async function checkChatAccess(client, chatId) {
    try {
        await client.getInputEntity(chatId);
        return true;
    } catch (err) {
        console.error(`❌ Нет доступа к чату ${chatId}:`, err.message);
        return false;
    }
}

// === Отправка в чат ===
async function sendToChat(clientObj, chatId, link, imagePath) {
    try {
        // Проверяем доступ к чату
        if (!(await checkChatAccess(clientObj.client, chatId))) {
            return false;
        }

        // Отправляем ссылку
        await clientObj.client.sendMessage(chatId, {
            message: link
        });
        console.log(`📨 [${clientObj.username}] Ссылка отправлена в ${chatId}`);

        // Отправляем скриншот если есть
        if (imagePath) {
            await clientObj.client.sendFile(chatId, {
                file: imagePath
            });
            console.log(`🖼️ [${clientObj.username}] Скриншот отправлен`);
            fs.unlinkSync(imagePath);
        }

        return true;
    } catch (err) {
        console.error(`❌ [${clientObj.username}] Ошибка отправки:`, err.message);
        return false;
    }
}

// === Обработка ссылки ===
async function processVkLink(link) {
    try {
        const parsed = parseVkPostUrl(link);
        if (!parsed) {
            console.warn(`🚫 Неверная ссылка: ${link}`);
            return;
        }

        const ownerVkId = Math.abs(parseInt(parsed.ownerId));
        console.log(`🔍 Пост от VK ID: ${ownerVkId}`);

        // Ищем подходящий аккаунт в конфиге (без предварительной инициализации)
        let targetAccount = null;
        
        for (const acc of ACCOUNTS) {
            if (!acc.vk_token) continue;
            
            try {
                // Для проверки соответствия сначала смотрим указанный vk_user_id
                if (acc.vk_user_id && Math.abs(acc.vk_user_id) === ownerVkId) {
                    targetAccount = acc;
                    break;
                }
                
                // Если vk_user_id не указан, получаем его из API VK
                if (!acc.vk_user_id) {
                    const accVkId = await getVkUserId(acc.vk_token);
                    if (accVkId === ownerVkId) {
                        targetAccount = acc;
                        break;
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Ошибка проверки аккаунта ${acc.id}:`, err.message);
            }
        }

        if (!targetAccount) {
            console.warn(`🚫 Не найден аккаунт для VK ID ${ownerVkId}`);
            return;
        }

        // Проверяем, есть ли уже инициализированный клиент
        let clientObj = clients.find(c => c.id === targetAccount.id);
        
        // Если нет - инициализируем только этот аккаунт
        if (!clientObj) {
            console.log(`⚡ Инициализируем аккаунт ${targetAccount.id}...`);
            clientObj = await initClient(targetAccount);
            if (clientObj) {
                clients.push(clientObj);
            } else {
                console.warn(`⚠️ Не удалось подключить аккаунт ${targetAccount.id}`);
                return;
            }
        }

        // Готовим данные для отправки
        const targetChatId = clientObj.chat_id || targetAccount.chat_id;
        console.log(`💬 Отправляем в чат: ${targetChatId}`);
        
        const screenshotPath = await generateScreenshot(link);
        await sendToChat(clientObj, targetChatId, link, screenshotPath);

    } catch (err) {
        console.error(`❌ Ошибка обработки:`, err.message);
    }
}

// === Инициализация клиентов ===
async function initializeClients() {
    try {
        // Проверка конфигурации
        ACCOUNTS.forEach(acc => {
            if (!acc.api_id || !acc.api_hash) {
                console.log(`ℹ️ Аккаунт ${acc.id} использует дефолтные API credentials`);
            }
        });

        // Инициализация всех клиентов
        for (const account of ACCOUNTS) {
            const client = await initClient(account);
            if (client) {
                clients.push(client);
            }
            await delay(1000); // Задержка между инициализацией аккаунтов
        }

        console.log(`✅ Инициализировано ${clients.length} клиентов из ${ACCOUNTS.length} аккаунтов`);
    } catch (err) {
        console.error("Критическая ошибка при инициализации клиентов:", err);
        process.exit(1);
    }
}

// === Настройка Express ===
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// API endpoint для обработки ссылок
app.post('/api/process', async (req, res) => {
    try {
        const { links } = req.body;
        
        if (!Array.isArray(links) || links.length === 0) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Необходимо предоставить массив ссылок' 
            });
        }

        // Обработка каждой ссылки
        const results = [];
        for (const link of links) {
            try {
                await processVkLink(link);
                results.push({ link, status: 'success' });
                await delay(1000); // Задержка между обработкой ссылок
            } catch (error) {
                results.push({ 
                    link, 
                    status: 'error', 
                    message: error.message 
                });
            }
        }

        // Формируем итоговое сообщение
        const successCount = results.filter(r => r.status === 'success').length;
        const message = `Успешно обработано: ${successCount} из ${links.length}`;

        res.json({
            status: 'success',
            message,
            results
        });

    } catch (error) {
        console.error('Ошибка в API:', error);
        res.status(500).json({
            status: 'error',
            message: 'Внутренняя ошибка сервера'
        });
    }
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Завершение работы...');
    for (const client of clients) {
        await client.client.disconnect();
    }
    process.exit();
});
// === CLI интерфейс ===
async function processFromStdin() {
    return new Promise((resolve) => {
        let data = '';
        
        process.stdin.setEncoding('utf8');
        
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });

        process.stdin.on('end', async () => {
            // Разделяем ссылки по пробелам и фильтруем
            const links = data.split(/\s+/)
                .map(link => link.trim())
                .filter(link => link.includes('vk.com/wall'));
            
            if (links.length === 0) {
                console.log("❌ Нет ссылок для обработки");
                return resolve(false);
            }

            console.log(`\nОбработка ${links.length} ссылок...`);
            for (const link of links) {
                await processVkLink(link);
                await delay(1000);
            }

            console.log("\n✅ Готово");
            resolve(true);
        });
    });
}

// === Запуск приложения ===
(async () => {
    try {
        // Проверка конфигурации (только вывод информации)
        ACCOUNTS.forEach(acc => {
            if (!acc.api_id || !acc.api_hash) {
                console.log(`ℹ️ Аккаунт ${acc.id} использует дефолтные API credentials`);
            }
        });

        // Определяем режим работы
        if (process.argv.includes('--server')) {
            // Режим сервера
            app.listen(PORT, () => {
                console.log(`Сервер запущен на порту ${PORT}`);
                console.log(`Аккаунты будут подгружаться по необходимости`);
            });
        } else if (process.stdin.isTTY) {
            // Интерактивный режим (не используется)
            console.log("Для обработки ссылок передайте их через stdin или используйте --server для запуска сервера");
            process.exit(0);
        } else {
            // Режим CLI (обработка из stdin)
            await processFromStdin();
            
            // После обработки отключаем все использованные клиенты
            for (const client of clients) {
                await client.client.disconnect();
            }
            process.exit(0);
        }
    } catch (err) {
        console.error("Критическая ошибка:", err);
        process.exit(1);
    }
})();