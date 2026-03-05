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
    const mediaGroupId = ctx.message.media_group_id; // ID альбома
    if (!photo) return;

    // 1. Загрузка фото (как обычно)
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

    // 2. Сразу отправляем одиночную ссылку
    await ctx.reply(publicUrl);

    // 3. Если это часть альбома, сохраняем в БД и проверяем группу
    if (mediaGroupId) {
      // Сохраняем ссылку с ID группы
      await supabase.from('temp_uploads').insert([{ 
        url: publicUrl, 
        media_group_id: mediaGroupId 
      }]);

      // Ждем полсекунды (короткая задержка допустима)
      await new Promise(resolve => setTimeout(resolve, 800));

      // Получаем все ссылки этого альбома из базы
      const { data: groupPhotos } = await supabase
        .from('temp_uploads')
        .select('url')
        .eq('media_group_id', mediaGroupId);

      // Если ссылок несколько, отправляем их списком
      // Мы делаем это для каждого фото, но фильтруем, чтобы не спамить
      // Список отправится только после загрузки последнего фото группы
      if (groupPhotos && groupPhotos.length > 1) {
         // Чтобы не спамить списком после каждого фото, отправим его только 
         // когда количество ссылок в БД перестанет расти (или просто последним сообщением)
         // Для удобства — добавим кнопку "Собрать список", если хочешь, 
         // но пока просто выведем накопившееся
         const allUrls = groupPhotos.map(p => p.url).join('\n\n');
         
         // Трюк: отправляем список только если текущее фото — "последнее пришедшее" в запросе
         // В Serverless это сложно поймать, поэтому просто присылаем обновление списка
         await ctx.reply(`📋 Накопленный список ссылок:\n\n${allUrls}`);
      }
    }

  } catch (err) {
    console.error(err);
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