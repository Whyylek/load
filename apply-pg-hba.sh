#!/bin/sh
set -e

# Шлях до конфігураційного файлу всередині контейнера
CONF_FILE="/var/lib/postgresql/data/pg_hba.conf"

# Чекаємо, поки файл pg_hba.conf буде створено
while [ ! -f "$CONF_FILE" ]
do
  echo "Очікування на $CONF_FILE..."
  sleep 1
done

echo "Знайдено $CONF_FILE. Додаємо правила 'trust'."

# Додаємо правила 'trust' на початок файлу.
# Це дозволить підключатися з localhost (127.0.0.1) та Docker (172.*) БЕЗ ПАРОЛЯ.
# ВАЖЛИВО: Це лише для розробки!
cat > /tmp/new_hba.conf <<EOF
# --- НАШІ ПРАВИЛА ДЛЯ РОЗРОБКИ (без пароля) ---
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             172.16.0.0/12           trust
# --- Кінець наших правил ---

# Стандартні правила, що були в файлі:
EOF

# Додаємо старий вміст файлу після наших нових правил
cat $CONF_FILE >> /tmp/new_hba.conf

# Замінюємо оригінальний файл новим
mv /tmp/new_hba.conf $CONF_FILE

echo "Нові правила 'trust' застосовано до $CONF_FILE:"
cat $CONF_FILE

# Перезавантажуємо конфігурацію PostgreSQL, щоб зміни вступили в силу
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_reload_conf();"
echo "Конфігурацію PostgreSQL перезавантажено."