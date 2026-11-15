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
  const spoiler = settings.antiSpoiler;
  const identity = settings['channel.identity'];
  const research = settings.research;
  const character = settings.character;

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
          title="Orçamento de APIs"
          description="Claude + voz + imagem. Ao atingir o teto, os agentes pausam."
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="monthlyUsd">Teto mensal (US$)</Label>
              <Input
                id="monthlyUsd"
                name="monthlyUsd"
                type="number"
                step="0.01"
                min={0}
                defaultValue={budget.monthlyUsd}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dailyUsd">Teto diário (US$)</Label>
              <Input
                id="dailyUsd"
                name="dailyUsd"
                type="number"
                step="0.01"
                min={0}
                defaultValue={budget.dailyUsd}
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
            description="Desligado: a voz do Google para em 95% da cota grátis do mês. Ligado: segue até o teto de gasto (US$ 30 por milhão de caracteres)."
          />
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
