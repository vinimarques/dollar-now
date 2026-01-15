#!/usr/bin/env node

/**
 * Script para gerar ícones PNG a partir do favicon.svg
 * Tenta usar sharp primeiro, depois rsvg-convert como fallback
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const svgPath = path.join(__dirname, 'favicon.svg');
const sizes = [
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' }
];

async function generateWithSharp() {
  const sharp = require('sharp');
  const svgBuffer = fs.readFileSync(svgPath);

  console.log('🎨 Gerando ícones com sharp...\n');

  for (const { size, name } of sizes) {
    const outputPath = path.join(__dirname, name);
    await sharp(svgBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(outputPath);
    console.log(`✅ ${name} (${size}x${size}) criado`);
  }
}

function generateWithRsvgConvert() {
  console.log('🎨 Gerando ícones com rsvg-convert...\n');

  // Verificar se rsvg-convert está disponível
  let rsvgPath;
  try {
    rsvgPath = execSync('which rsvg-convert', { encoding: 'utf-8' }).trim();
  } catch (e) {
    throw new Error('rsvg-convert não encontrado. Instale com: brew install librsvg');
  }

  for (const { size, name } of sizes) {
    const outputPath = path.join(__dirname, name);
    execSync(`${rsvgPath} -w ${size} -h ${size} ${svgPath} > ${outputPath}`);
    console.log(`✅ ${name} (${size}x${size}) criado`);
  }
}

async function generateIcons() {
  if (!fs.existsSync(svgPath)) {
    console.error(`❌ Arquivo não encontrado: ${svgPath}`);
    process.exit(1);
  }

  try {
    // Tentar usar sharp primeiro
    await generateWithSharp();
    console.log('\n✨ Ícones gerados com sucesso usando sharp!');
  } catch (e) {
    console.log('⚠️  sharp não disponível, tentando rsvg-convert...\n');
    try {
      generateWithRsvgConvert();
      console.log('\n✨ Ícones gerados com sucesso usando rsvg-convert!');
    } catch (error) {
      console.error('❌ Erro:', error.message);
      console.log('\n💡 Opções:');
      console.log('   1. Instale sharp: npm install sharp --save-dev');
      console.log('   2. Instale librsvg: brew install librsvg');
      process.exit(1);
    }
  }
}

generateIcons().catch(error => {
  console.error('❌ Erro:', error);
  process.exit(1);
});
