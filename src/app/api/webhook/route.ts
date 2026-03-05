import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  if (userId.toString() !== process.env.MY_TELEGRAM_ID) return;

  try {
    const photo = ctx.message.photo.pop();
    if (!photo) return;

    // 1. Обработка и загрузка (как и было)
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileLink.href);
    const inputBuffer = Buffer.from(await response.arrayBuffer());

    const optimizedBuffer = await sharp(inputBuffer)
      .resize(1200, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(fileName, optimizedBuffer, { contentType: 'image/webp' });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);

    // 2. СРАЗУ присылаем одиночную ссылку
    await ctx.reply(publicUrl);

    // 3. Сохраняем в таблицу "черновик"
    await supabase.from('temp_uploads').insert([{ url: publicUrl }]);

    // 4. Логика "Сбора пачки"
    // Ждем 3 секунды, чтобы убедиться, что все фото из альбома дошли
    setTimeout(async () => {
      // Проверяем, сколько ссылок накопилось за последние 5 секунд
      const { data: recentLinks } = await supabase
        .from('temp_uploads')
        .select('url')
        .gt('created_at', new Date(Date.now() - 5000).toISOString());

      if (recentLinks && recentLinks.length > 1) {
        // Проверяем, не отправляли ли мы этот список только что (чтобы не дублировать)
        // Для простоты: если текущая ссылка — последняя в списке, то отправляем весь список
        if (recentLinks[recentLinks.length - 1].url === publicUrl) {
          const allUrls = recentLinks.map(img => img.url).join('\n\n');
          await ctx.reply(`📋 Весь список для карточки:\n\n${allUrls}`);
        }
      }
    }, 3500);

  } catch (err) {
    console.error(err);
    ctx.reply('Ошибка ❌');
  }
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 });
  }
}