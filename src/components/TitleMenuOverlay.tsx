import React from 'react';
import { ArrowRight, Settings, ShieldCheck, Sparkles, Users } from 'lucide-react';
import villageHeroImg from '../assets/images/village_hero_scene_1794560536661.jpg';
import mattPortraitImg from '../assets/images/chief_of_staff_matt_1794560538124.jpg';
import guildhavenAvatarImg from '../assets/images/guildhaven_chat_avatar_1794833257258.jpg';

interface TitleMenuOverlayProps {
  onEnterVillage: () => void;
  onGoogleSignIn: () => void;
  onOpenSettings?: () => void;
  isGoogleConnected: boolean;
  userEmail?: string | null;
}

export const TitleMenuOverlay: React.FC<TitleMenuOverlayProps> = ({
  onEnterVillage,
  onGoogleSignIn,
  onOpenSettings,
  isGoogleConnected,
  userEmail,
}) => {
  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between gap-6">
            <div>
              <p className="text-xs font-medium tracking-wide text-amber-400">
                Interactive Guild Command Square · Google Workspace Ready
              </p>
              <div className="mt-3 flex items-center gap-3.5">
                <img
                  src={guildhavenAvatarImg}
                  alt="Guildhaven lantern emblem"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-xl border border-amber-500/40 object-cover shrink-0"
                />
                <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl text-balance">
                  Guildhaven
                </h1>
              </div>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">
                Step inside your living command square where you are the Chief Human Officer.
                Delegate big goals to Matt and eight Guild Directors, chat or call any specialist
                live, and review every external Workspace action before it happens.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-slate-800/80 pt-6">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Users className="h-4 w-4 text-amber-400" />
                  <span>1. Delegate to Matt</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Assign tasks in the bottom command bar. Matt routes each brief to the right Guild Director and returns a report.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-sky-400" />
                  <span>2. Chat or Visit Guilds</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Use the Directory or walk the square to chat, start a voice call, host Town Hall briefings, or hire new staff.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>3. Confirm Every Action</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Emails always stay drafts, Workspace tools live in one hub, and Calendar or Drive writes respect your guardrails.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={onEnterVillage}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Enter Guildhaven</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="h-4 w-4 text-amber-400" />
                  <span>Settings</span>
                </button>
              )}

              {!isGoogleConnected ? (
                <button onClick={onGoogleSignIn} className="gsi-material-button">
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">Sign in with Google</span>
                  </div>
                </button>
              ) : (
                <span className="text-xs text-emerald-300">
                  Connected · {userEmail || 'Google Workspace'}
                </span>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <img
                src={villageHeroImg}
                alt="Guildhaven top-down town square"
                referrerPolicy="no-referrer"
                className="h-64 w-full object-cover lg:h-72"
              />
              <div className="bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-4 flex items-center gap-3">
                <img
                  src={mattPortraitImg}
                  alt="Matt, Chief of Staff"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-lg object-cover border border-amber-500/40 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Matt · Chief of Staff</p>
                  <p className="text-xs text-slate-300 truncate">
                    Ready at the Town Square to route tasks and summon Directors.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
