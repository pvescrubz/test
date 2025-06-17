document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submitBtn');
    const linksInput = document.getElementById('links'); // Изменим textarea на input
    const statusDiv = document.getElementById('status');

    submitBtn.addEventListener('click', async () => {
        // Разделяем ссылки по пробелам и фильтруем только валидные
        const links = linksInput.value
            .split(' ')
            .map(link => link.trim())
            .filter(link => link.includes('vk.com/wall'));
        
        if (links.length === 0) {
            statusDiv.textContent = '❌ Нет валидных ссылок VK';
            statusDiv.className = 'error';
            return;
        }

        submitBtn.disabled = true;
        statusDiv.textContent = `⏳ Обработка ${links.length} ссылок...`;
        statusDiv.className = 'progress';

        try {
            const response = await fetch('/api/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ links }),
            });

            const result = await response.json();

            if (result.status === 'success') {
                statusDiv.textContent = `✅ ${links.length} ссылок успешно отправлены!\n${result.message}`;
                statusDiv.className = 'success';
            } else {
                statusDiv.textContent = '❌ Ошибка: ' + result.message;
                statusDiv.className = 'error';
            }
        } catch (error) {
            statusDiv.textContent = '❌ Ошибка соединения: ' + error.message;
            statusDiv.className = 'error';
        } finally {
            submitBtn.disabled = false;
        }
    });
});