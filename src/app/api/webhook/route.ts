import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

// Инициализация
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Логика обработки фото
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;

  // Проверка доступа
  if (userId.toString() !== process.env.MY_TELEGRAM_ID) {
    return ctx.reply('Доступ ограничен 🔒');
  }

  try {
    ctx.reply('Обрабатываю фото... ⏳');

    // 1. Получаем файл (самый большой размер)
    const photo = ctx.message.photo.pop();
    if (!photo) return;

    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileLink.href);
    const arrayBuffer = await response.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // 2. Сжатие и оптимизация через Sharp
    const optimizedBuffer = await sharp(inputBuffer)
      .resize(1200, null, { withoutEnlargement: true }) // Ресайз до 1200px
      .webp({ quality: 80 }) // Конвертация в легкий WebP
      .toBuffer();

    // 3. Загрузка в Supabase
    const fileName = `${Date.now()}.webp`;
    const { data, error } = await supabase.storage
      .from('images') // Убедись, что бакет называется именно так
      .upload(fileName, optimizedBuffer, {
        contentType: 'image/webp',
        upsert: true
      });

    if (error) throw error;

    // 4. Получение ссылки
    const { data: { publicUrl } } = supabase.storage
      .from('images')
      .getPublicUrl(fileName);

    await ctx.reply(`Готово! ✅\n\nСсылка:\n${publicUrl}`);

  } catch (err) {
    console.error(err);
    ctx.reply('Произошла ошибка при загрузке ❌');
  }
});

// Хендлер для Vercel (принимает POST запросы от TG)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 });
  }
}