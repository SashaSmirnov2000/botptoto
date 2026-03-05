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
    const mediaGroupId = ctx.message.media_group_id;
    if (!photo) return;

    // 1. Загрузка и оптимизация
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileLink.href);
    const inputBuffer = Buffer.from(await response.arrayBuffer());

    const optimizedBuffer = await sharp(inputBuffer)
      .resize(1200, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;
    await supabase.storage
      .from('images')
      .upload(fileName, optimizedBuffer, { contentType: 'image/webp' });

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);

    // 2. Отправляем одиночную ссылку (для контроля)
    await ctx.reply(publicUrl);

    // 3. Работа с группой фото
    if (mediaGroupId) {
      await supabase.from('temp_uploads').insert([{ 
        url: publicUrl, 
        media_group_id: mediaGroupId 
      }]);

      // Небольшая пауза, чтобы база успела обновиться
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: groupPhotos } = await supabase
        .from('temp_uploads')
        .select('url')
        .eq('media_group_id', mediaGroupId);

      if (groupPhotos && groupPhotos.length > 1) {
        // ФОРМАТ: ссылка пробел запятая пробел ссылка
        const allUrls = groupPhotos.map(p => p.url).join(' , ');
         
        await ctx.reply(`📋 Готовый список для вставки:\n\n${allUrls}`);
      }
    }

  } catch (err) {
    console.error('Ошибка:', err);
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