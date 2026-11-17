import { currentFx, getPrisma } from '@studio/db';
import { formatBrl, formatBrlRate } from '@studio/shared';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Input, Label, Select, Toggle } from '@/components/ui/input';
import { effectiveState } from '@/server/effective';
import { SettingForm } from './setting-form';

export const metadata: Metadata = { title: 'Configurações' };

/** Sugestões (a lista real da sua chave sai em `make vozes`, com amostras para ouvir). */
const CHIRP_SUGGESTIONS = [
  'Puck',
  'Charon',
  'Fenrir',
  'Orus',
  'Iapetus',
  'Enceladus',
  'Algenib',
  'Alnilam',
];

export default async function SettingsPage() {
  const { env, settings, profileInfo } = await effectiveState();
  const limits = settings['limits.daily'];
  const budget = settings.budget;
  const currency = settings.currency;
  const fx = await currentFx(getPrisma());
  const spoiler = settings.antiSpoiler;
  const identity = settings['channel.identity'];
  const research = settings.research;
  const character = settings.character;
  const production = settings.production;
  const images = settings.images;
  const partners = settings.partners;
  const react = settings.react;

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Toda alteração fica registrada na auditoria (tela Saúde). Chaves de API e a conexão com o canal entram nas próximas fases."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingForm
          settingKey="mode.simulation"
          title="Modo simulado"
          description="TTS e imagem falsos e upload simulado: gera tudo, mas não gasta nada nem envia ao YouTube."
        >
          <Toggle
            name="enabled"
            defaultChecked={settings['mode.simulation']}
            label="Modo simulado ligado"
            description="Desligue só quando for testar com APIs reais."
            data-testid="toggle-simulacao"
          />
        </SettingForm>

        <SettingForm
          settingKey="profile.override"
          title="Perfil"
          description={`Ativo agora: ${profileInfo.label}. O .env define APP_PROFILE=${env.APP_PROFILE}; os limites de CPU e memória dos containers seguem o arquivo Compose.`}
        >
          <div className="space-y-1.5">
            <Label htmlFor="profile">Perfil dos ajustes do app</Label>
            <Select id="profile" name="profile" defaultValue={settings['profile.override']}>
              <option value="env">Usar o do .env ({env.APP_PROFILE})</option>
              <option value="notebook">Notebook (720p, 1 render por vez)</option>
              <option value="vps">VPS (1080p, produção)</option>
            </Select>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="limits.daily"
          title="Limites diários"
          description="Máximo de publicações por dia."
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="long">Vídeos longos</Label>
              <Input
                id="long"
                name="long"
                type="number"
                min={0}
                max={5}
                defaultValue={limits.long}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shorts">Shorts</Label>
              <Input
                id="shorts"
                name="shorts"
                type="number"
                min={0}
                max={20}
                defaultValue={limits.shorts}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="budget"
          title="Orçamento de APIs (R$)"
          description="Claude + voz + imagem, em reais (as APIs cobram em dólar; o estúdio converte pela cotação abaixo). Ao atingir o teto, os agentes pausam."
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="monthlyBrl">Teto mensal (R$)</Label>
              <Input
                id="monthlyBrl"
                name="monthlyBrl"
                type="number"
                step="0.01"
                min={0}
                defaultValue={budget.monthlyBrl}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dailyBrl">Teto diário (R$)</Label>
              <Input
                id="dailyBrl"
                name="dailyBrl"
                type="number"
                step="0.01"
                min={0}
                defaultValue={budget.dailyBrl}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="currency"
          title="Cotação do dólar"
          description={`Em uso: ${formatBrlRate(fx.rate)} ${fx.source === 'bcb-ptax' ? `(PTAX do Banco Central, ${fx.day?.split('-').reverse().join('/')})` : fx.source === 'manual' ? '(fixa)' : '(reserva, até a primeira busca no Banco Central)'} → ${formatBrl(fx.effective)} com spread e IOF. A automática é atualizada a cada 6 horas.`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fx-source">Fonte</Label>
              <Select id="fx-source" name="source" defaultValue={currency.source}>
                <option value="bcb">Banco Central (PTAX, automática)</option>
                <option value="manual">Fixa (digito abaixo)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-manual">Cotação fixa (R$ por dólar)</Label>
              <Input
                id="fx-manual"
                name="manualRate"
                type="number"
                step="0.0001"
                min={1}
                max={30}
                defaultValue={currency.manualRate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-iof">IOF do cartão (%)</Label>
              <Input
                id="fx-iof"
                name="iofPercent"
                type="number"
                step="0.01"
                min={0}
                max={20}
                defaultValue={currency.iofPercent}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-spread">Spread do banco sobre o dólar (%)</Label>
              <Input
                id="fx-spread"
                name="spreadPercent"
                type="number"
                step="0.01"
                min={0}
                max={20}
                defaultValue={currency.spreadPercent}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="render.resolution"
          title="Resolução do render"
          description="Automático segue o perfil (notebook 720p, VPS 1080p)."
        >
          <Select
            name="resolution"
            defaultValue={settings['render.resolution']}
            aria-label="Resolução"
          >
            <option value="auto">Automático ({profileInfo.renderHeight}p)</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </Select>
        </SettingForm>

        <SettingForm
          settingKey="antiSpoiler"
          title="Anti-spoiler"
          description="Depois do lançamento, nada de final ou grandes reviravoltas da história dentro da janela."
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="launchDate">Lançamento</Label>
              <Input
                id="launchDate"
                name="launchDate"
                type="date"
                defaultValue={spoiler.launchDate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="windowDays">Janela (dias)</Label>
              <Input
                id="windowDays"
                name="windowDays"
                type="number"
                min={0}
                max={365}
                defaultValue={spoiler.windowDays}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="research"
          title="Pesquisa de notícias"
          description="Frequência da coleta, janela da pauta e buscas diárias no YouTube (cada busca usa o balde caro da cota)."
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="intervalMinutes">A cada (min)</Label>
              <Input
                id="intervalMinutes"
                name="intervalMinutes"
                type="number"
                min={10}
                max={1440}
                defaultValue={research.intervalMinutes}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="windowHours">Janela (h)</Label>
              <Input
                id="windowHours"
                name="windowHours"
                type="number"
                min={12}
                max={336}
                defaultValue={research.windowHours}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="youtubeSearchesPerDay">Buscas YouTube/dia</Label>
              <Input
                id="youtubeSearchesPerDay"
                name="youtubeSearchesPerDay"
                type="number"
                min={0}
                max={20}
                defaultValue={research.youtubeSearchesPerDay}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="character"
          title="Voz do Zeca"
          description="Google Chirp 3 HD (voz real) ou a voz de teste. Com o modo simulado ligado, os clipes usam a voz de teste. A chave GOOGLE_TTS_API_KEY fica só no .env."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ttsProvider">Voz</Label>
              <Select id="ttsProvider" name="ttsProvider" defaultValue={character.ttsProvider}>
                <option value="google">Google Chirp 3 HD (real)</option>
                <option value="fake">Voz de teste (espeak, robótica)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="googleVoice">Voz do Google</Label>
              <Input
                id="googleVoice"
                name="googleVoice"
                list="vozes-chirp"
                defaultValue={character.googleVoice}
                pattern="[a-z]{2,3}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+"
              />
              <datalist id="vozes-chirp">
                {CHIRP_SUGGESTIONS.map((v) => (
                  <option key={v} value={`pt-BR-Chirp3-HD-${v}`} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="speakingRate">Velocidade (0,75 a 1,5)</Label>
              <Input
                id="speakingRate"
                name="speakingRate"
                type="number"
                step={0.05}
                min={0.75}
                max={1.5}
                defaultValue={character.speakingRate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="freeCharsPerMonth">Cota grátis do mês (caracteres)</Label>
              <Input
                id="freeCharsPerMonth"
                name="freeCharsPerMonth"
                type="number"
                min={0}
                step={1000}
                defaultValue={character.freeCharsPerMonth}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="layout">Formato padrão do clipe</Label>
              <Select id="layout" name="layout" defaultValue={character.layout}>
                <option value="landscape">Vídeo longo (16:9)</option>
                <option value="vertical">Short (9:16)</option>
              </Select>
            </div>
          </div>
          <Toggle
            name="allowPaid"
            defaultChecked={character.allowPaid}
            label="Permitir pagar além da cota grátis"
            description={`Desligado: a voz do Google para em 95% da cota grátis do mês. Ligado: segue até o teto de gasto (~${formatBrl(fx.usdToBrl(30))} por milhão de caracteres).`}
          />
        </SettingForm>

        <SettingForm
          settingKey="production"
          title="Produção de vídeos"
          description="Modelo do Claude que escreve o roteiro e faz a revisão visual (custo por vídeo), duração-alvo e voltas do Revisor."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="writerModel">Roteirista</Label>
              <Select id="writerModel" name="writerModel" defaultValue={production.writerModel}>
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (recomendado)</option>
                <option value="claude-opus-5-5">Claude Opus 5.5 (melhor texto, ~2x o custo)</option>
                <option value="claude-haiku-5-5">Claude Haiku 5.5 (mais barato)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reviewerModel">Revisor visual</Label>
              <Select
                id="reviewerModel"
                name="reviewerModel"
                defaultValue={production.reviewerModel}
              >
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (recomendado)</option>
                <option value="claude-opus-5-5">Claude Opus 5.5</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="longTargetSec">Duração do vídeo longo (s de narração)</Label>
              <Input
                id="longTargetSec"
                name="longTargetSec"
                type="number"
                min={90}
                max={600}
                defaultValue={production.longTargetSec}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shortTargetSec">Duração do Short (s de narração)</Label>
              <Input
                id="shortTargetSec"
                name="shortTargetSec"
                type="number"
                min={20}
                max={58}
                defaultValue={production.shortTargetSec}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxReviewRounds">Voltas do Revisor (1 a 3)</Label>
              <Input
                id="maxReviewRounds"
                name="maxReviewRounds"
                type="number"
                min={1}
                max={3}
                defaultValue={production.maxReviewRounds}
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="images"
          title="Imagens geradas"
          description="Google (Imagen 4 / Gemini) com a chave GEMINI_API_KEY do .env, ou imagens de teste. Com o modo simulado ligado, as imagens são de teste. Rode `make imagens` para ver os modelos da sua chave e comparar."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="img-provider">Provedor</Label>
              <Select id="img-provider" name="provider" defaultValue={images.provider}>
                <option value="google">
                  Google (pago, ~{formatBrl(fx.usdToBrl(0.02))} a {formatBrl(fx.usdToBrl(0.07))} por
                  imagem)
                </option>
                <option value="fake">Imagens de teste (grátis)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="img-model">Modelo do Google</Label>
              <Input
                id="img-model"
                name="model"
                list="modelos-imagem"
                defaultValue={images.model}
                pattern="[a-z0-9][a-z0-9.\-]{2,80}"
              />
              <datalist id="modelos-imagem">
                <option value="imagen-4.0-fast-generate-001" />
                <option value="imagen-4.0-generate-001" />
                <option value="gemini-3.1-flash-image-preview" />
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxPerLong">Imagens novas por vídeo longo</Label>
              <Input
                id="maxPerLong"
                name="maxPerLong"
                type="number"
                min={0}
                max={20}
                defaultValue={images.maxPerLong}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxPerShort">Imagens novas por Short</Label>
              <Input
                id="maxPerShort"
                name="maxPerShort"
                type="number"
                min={0}
                max={8}
                defaultValue={images.maxPerShort}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="img-style">Guia de estilo (inglês, vai em todo pedido)</Label>
              <textarea
                id="img-style"
                name="style"
                rows={3}
                defaultValue={images.style}
                className="w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-white focus:border-neon-cyan focus:outline-none"
              />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="partners"
          title="Parceiros"
          description="Caçador semanal (busca no YouTube só por dados públicos e triagem com o Claude Haiku; nunca envia mensagens) e limites dos arquivos importados."
        >
          <div className="space-y-3">
            <Toggle
              name="huntWeekly"
              defaultChecked={partners.huntWeekly}
              label="Caçador toda semana"
              description="Cada rodada usa 1 busca do YouTube por termo e custa centavos com o Haiku."
            />
            <div className="space-y-1.5">
              <Label htmlFor="huntQueries">Termos da busca (até 3, separados por vírgula)</Label>
              <Input
                id="huntQueries"
                name="huntQueries"
                defaultValue={partners.huntQueries.join(', ')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="huntMaxChannels">Canais por rodada</Label>
                <Input
                  id="huntMaxChannels"
                  name="huntMaxChannels"
                  type="number"
                  min={5}
                  max={50}
                  defaultValue={partners.huntMaxChannels}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minSubscribers">Mínimo de inscritos</Label>
                <Input
                  id="minSubscribers"
                  name="minSubscribers"
                  type="number"
                  min={0}
                  defaultValue={partners.minSubscribers}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxImportMb">Arquivo máximo (MB)</Label>
                <Input
                  id="maxImportMb"
                  name="maxImportMb"
                  type="number"
                  min={20}
                  max={2000}
                  defaultValue={partners.maxImportMb}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxClipMinutes">Vídeo máximo (min)</Label>
                <Input
                  id="maxClipMinutes"
                  name="maxClipMinutes"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={partners.maxClipMinutes}
                />
              </div>
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="react"
          title="Short de react"
          description="O clipe do parceiro nunca passa de 50% do Short (regra 3); aqui dá para deixar mais rígido. O Zeca comenta com o clipe pausado."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="react-target">Duração-alvo do Short (s)</Label>
              <Input
                id="react-target"
                name="targetSec"
                type="number"
                min={20}
                max={58}
                defaultValue={react.targetSec}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="react-ratio">Clipe no máximo (% do Short)</Label>
              <Input
                id="react-ratio"
                name="maxClipPercent"
                type="number"
                min={20}
                max={50}
                defaultValue={Math.round(react.maxClipRatio * 100)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="react-model">Comentarista</Label>
              <Select
                id="react-model"
                name="commentatorModel"
                defaultValue={react.commentatorModel}
              >
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (recomendado)</option>
                <option value="claude-opus-5-5">Claude Opus 5.5 (~2x o custo)</option>
              </Select>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-haze-300">Layouts no rodízio</legend>
              <div className="flex flex-wrap gap-3 text-sm text-haze-200">
                {(
                  [
                    ['tv', 'TV neon'],
                    ['split', 'Tela dividida'],
                    ['cinema', 'Cinema'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="layouts"
                      value={value}
                      defaultChecked={react.layouts.includes(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="channel.identity"
          title="Identidade"
          description="Nome do canal, do personagem e idioma dos roteiros."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="channelName">Canal</Label>
              <Input id="channelName" name="channelName" defaultValue={identity.channelName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="characterName">Personagem</Label>
              <Input
                id="characterName"
                name="characterName"
                defaultValue={identity.characterName}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="language">Idioma</Label>
              <Input id="language" name="language" defaultValue={identity.language} />
            </div>
          </div>
        </SettingForm>

        <SettingForm
          settingKey="mode.autopilot"
          title="Piloto automático"
          description="Publica sem esperar sua aprovação, mas sempre passando pela Conformidade e pelo Revisor visual. Disponível na Fase 7."
        >
          <Toggle
            name="enabled"
            defaultChecked={false}
            disabled
            label="Piloto automático"
            description="Desligado (Fase 7)"
          />
        </SettingForm>
      </div>
    </>
  );
}
