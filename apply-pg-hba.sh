
set -e


CONF_FILE="/var/lib/postgresql/data/pg_hba.conf"


while [ ! -f "$CONF_FILE" ]
do
  echo "Очікування на $CONF_FILE..."
  sleep 1
done

echo "Знайдено $CONF_FILE. Додаємо правила 'trust'."


cat > /tmp/new_hba.conf <<EOF
# --- НАШІ ПРАВИЛА ДЛЯ РОЗРОБКИ (без пароля) ---
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             172.16.0.0/12           trust
# --- Кінець наших правил ---

# Стандартні правила, що були в файлі:
EOF


cat $CONF_FILE >> /tmp/new_hba.conf


mv /tmp/new_hba.conf $CONF_FILE

echo "Нові правила 'trust' застосовано до $CONF_FILE:"
cat $CONF_FILE


psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_reload_conf();"
echo "Конфігурацію PostgreSQL перезавантажено."