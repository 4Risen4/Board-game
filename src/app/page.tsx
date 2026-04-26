"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Game, Profile, Review, ReviewProfile } from "@/lib/supabase";

type View = "rating" | "details";
type AuthMode = "signin" | "signup";

const bucketName = "covers";
const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
const telegramBotUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim() || "my_board_games_auth_bot";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [view, setView] = useState<View>("rating");
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [selectedGameId, setSelectedGameId] = useState("");
  const [expandedDescriptionId, setExpandedDescriptionId] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [viewAsFriend, setViewAsFriend] = useState(false);
  const [reviewFun, setReviewFun] = useState(8);
  const [reviewDifficulty, setReviewDifficulty] = useState(5);
  const [authMessage, setAuthMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0];
  const isOwner = profile?.role === "owner";
  const canManageGames = isOwner && !viewAsFriend;
  const reviewFormLooksOwner = isOwner && !viewAsFriend;
  const mySelectedReview = selectedGame && session?.user ? getUserReview(selectedGame, session.user.id) : null;

  const sortedGames = useMemo(() => {
    return [...games].sort((first, second) => {
      const friendScoreDifference = total(publicReviews(second), "fun") - total(publicReviews(first), "fun");
      if (friendScoreDifference !== 0) return friendScoreDifference;

      return ownerTieScore(second) - ownerTieScore(first);
    });
  }, [games]);

  const friendsCount = useMemo(() => {
    return new Set(games.flatMap((game) => publicReviews(game).map((review) => review.user_id))).size;
  }, [games]);

  const reviewsCount = useMemo(() => {
    return games.reduce((count, game) => count + publicReviews(game).length, 0);
  }, [games]);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) {
      setPasswordRecovery(true);
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      }
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setGames([]);
      return;
    }

    loadProfile();
    loadGames();
  }, [session]);

  useEffect(() => {
    setReviewFun(mySelectedReview?.fun || 8);
    setReviewDifficulty(mySelectedReview?.difficulty || 5);
  }, [mySelectedReview?.id, mySelectedReview?.fun, mySelectedReview?.difficulty, selectedGame?.id]);

  async function loadProfile() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,role,telegram_id,telegram_username,telegram_first_name,telegram_last_name,telegram_photo_url,telegram_linked_at")
      .eq("id", session?.user.id)
      .single();

    if (!error && data) {
      setProfile(data);
    }
  }

  async function loadGames() {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,title,description,cover_url,created_at,reviews(id,game_id,user_id,friend_name,fun,difficulty,comment,is_owner_review,created_at,profiles(display_name,email,role))",
      )
      .order("created_at", { ascending: false });

    if (error) {
      setFormMessage(error.message);
      return;
    }

    const loadedGames = (data || []) as unknown as Game[];
    setGames(loadedGames);
    setSelectedGameId((current) => current || loadedGames[0]?.id || "");
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    if (!displayName || !email || !password) return;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName },
      },
    });

    setAuthMessage(
      error
        ? error.message
        : "Готово. Теперь открой письмо от Supabase, подтверди e-mail и потом войди по паролю.",
    );
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setAuthMessage(error ? "Не получилось войти. Проверь e-mail, пароль и подтверждение почты." : "");
  }

  async function sendPasswordReset() {
    setAuthMessage("");
    if (!authEmail.trim()) {
      setAuthMessage("Сначала впиши e-mail.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
      redirectTo: window.location.origin,
    });

    setAuthMessage(error ? error.message : "Отправил письмо для смены пароля. Открой его и задай новый пароль.");
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setPasswordRecovery(false);
    setAuthMessage("");
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user) return;

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") || "").trim();
    if (!displayName) return;

    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", session.user.id);

    if (error) {
      setFormMessage(error.message);
      return;
    }

    setFormMessage("Ник обновлён.");
    loadProfile();
    loadGames();
  }

  async function addGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageGames) return;

    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const coverFile = form.get("cover") as File | null;

    if (!title) return;

    const coverUrl = coverFile?.size ? await uploadCover(coverFile) : null;
    const { error } = await supabase.from("games").insert({ title, description, cover_url: coverUrl });

    if (error) {
      setFormMessage(error.message);
      return;
    }

    event.currentTarget.reset();
    setFormMessage("Игра добавлена.");
    loadGames();
  }

  async function updateGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageGames || !selectedGame) return;

    const form = new FormData(event.currentTarget);
    const title = String(form.get("editTitle") || "").trim();
    const description = String(form.get("editDescription") || "").trim();
    const coverFile = form.get("editCover") as File | null;

    if (!title) return;

    const updates: Partial<Game> = { title, description };
    if (coverFile?.size) {
      updates.cover_url = await uploadCover(coverFile);
    }

    const { error } = await supabase.from("games").update(updates).eq("id", selectedGame.id);

    if (error) {
      setFormMessage(error.message);
      return;
    }

    event.currentTarget.reset();
    setFormMessage("Игра обновлена.");
    loadGames();
  }

  async function deleteSelectedGame() {
    if (!canManageGames || !selectedGame) return;
    const confirmed = window.confirm(
      `Удалить игру "${selectedGame.title}"? Вместе с ней удалятся все оценки и комментарии друзей.`,
    );
    if (!confirmed) return;

    const { error } = await supabase.from("games").delete().eq("id", selectedGame.id);

    if (error) {
      setFormMessage(error.message);
      return;
    }

    setSelectedGameId("");
    setFormMessage("Игра удалена.");
    loadGames();
  }

  async function addReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user || !selectedGame || !profile) return;

    const form = new FormData(event.currentTarget);
    const fun = Number(form.get("fun") || 8);
    const difficulty = Number(form.get("difficulty") || 5);
    const comment = String(form.get("comment") || "").trim();
    const reviewerName = profile.display_name || profile.email?.split("@")[0] || "Друг";

    const existingReview = getUserReview(selectedGame, session.user.id);
    const reviewPayload = {
      friend_name: reviewerName,
      fun,
      difficulty,
      comment,
      is_owner_review: isOwner,
    };

    const { error } = existingReview
      ? await supabase.from("reviews").update(reviewPayload).eq("id", existingReview.id).eq("user_id", session.user.id)
      : await supabase.from("reviews").insert({
          game_id: selectedGame.id,
          user_id: session.user.id,
          ...reviewPayload,
        });

    if (error) {
      setFormMessage(error.code === "23505" ? "Ты уже оставил оценку для этой игры." : error.message);
      return;
    }

    if (!existingReview) {
      event.currentTarget.reset();
    }

    setFormMessage(
      existingReview
        ? isOwner
          ? "Мнение Амирана обновлено."
          : "Оценка обновлена."
        : isOwner
          ? "Мнение Амирана сохранено отдельно."
          : "Оценка сохранена.",
    );
    loadGames();
  }

  async function copyShareLink() {
    const link = publicSiteUrl || window.location.origin;

    try {
      await navigator.clipboard.writeText(link);
      setFormMessage("Ссылка скопирована. Можно отправлять друзьям.");
    } catch {
      setFormMessage(`Ссылка для друзей: ${link}`);
    }
  }

  async function uploadCover(file: File) {
    const resized = await resizeCover(file);
    const path = `${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(bucketName).upload(path, resized, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
    return data.publicUrl;
  }

  if (loading) {
    return <main className="app-shell">Загрузка...</main>;
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Настольные игры</p>
          <h1>Моя полка игр</h1>
          <div className="auth-switch" role="tablist" aria-label="Вход или регистрация">
            <button
              className={authMode === "signin" ? "active" : ""}
              onClick={() => setAuthMode("signin")}
              type="button"
            >
              Вход
            </button>
            <button
              className={authMode === "signup" ? "active" : ""}
              onClick={() => setAuthMode("signup")}
              type="button"
            >
              Регистрация
            </button>
          </div>

          {authMode === "signup" ? (
            <form onSubmit={signUp} className="stack">
              <label>
                Ник
                <input name="displayName" placeholder="Как тебя будут видеть друзья" required />
              </label>
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Пароль
                <input name="password" type="password" minLength={6} required />
              </label>
              <button className="primary-button" type="submit">
                Создать аккаунт
              </button>
            </form>
          ) : (
            <form onSubmit={signIn} className="stack">
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Пароль
                <input name="password" type="password" required />
              </label>
              <button className="primary-button" type="submit">
                Войти
              </button>
              <button className="link-button" type="button" onClick={sendPasswordReset}>
                Задать или сбросить пароль
              </button>
            </form>
          )}

          <TelegramLoginButton session={session} onMessage={setAuthMessage} />

          {authMessage && <p className="form-message calm">{authMessage}</p>}
        </section>
      </main>
    );
  }

  if (passwordRecovery) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Настольные игры</p>
          <h1>Новый пароль</h1>
          <form onSubmit={updatePassword} className="stack">
            <label>
              Пароль
              <input name="password" type="password" minLength={6} required />
            </label>
            <button className="primary-button" type="submit">
              Сохранить пароль
            </button>
          </form>
          {authMessage && <p className="form-message calm">{authMessage}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Настольные игры</p>
          <h1>Моя полка игр</h1>
        </div>
        <div className="user-box">
          <span>{profile?.display_name || profile?.email || session.user.email}</span>
          {isOwner && (
            <button
              className={`mode-toggle ${viewAsFriend ? "active" : ""}`}
              type="button"
              onClick={() => setViewAsFriend((current) => !current)}
              aria-pressed={viewAsFriend}
            >
              {viewAsFriend ? "Вид друга" : "Вид владельца"}
            </button>
          )}
          <button className="ghost-button" type="button" onClick={copyShareLink}>
            Скопировать ссылку
          </button>
          <button className="ghost-button" type="button" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>

      {isOwner && (
        <section className={`mode-banner ${viewAsFriend ? "friend" : "owner"}`}>
          <strong>{viewAsFriend ? "Смотришь как друг" : "Режим владельца"}</strong>
          <span>
            {viewAsFriend
              ? "Админские формы скрыты, чтобы проверить обычный вид сайта."
              : "Можно добавлять, менять и удалять игры."}
          </span>
        </section>
      )}

      {!canManageGames && (
        <section className="mode-banner friend">
          <strong>Быстрый старт</strong>
          <span>Нажми на игру, поставь оценку и оставь комментарий. Если уже оценил игру, оценку можно изменить.</span>
        </section>
      )}

      <section className="summary-grid">
        <Summary value={games.length} label="игр" />
        <Summary value={reviewsCount} label="оценок друзей" />
        <Summary value={friendsCount} label="друзей" />
      </section>

      <section className="workspace">
        <aside className="panel input-panel">
          <form onSubmit={updateProfile} className="stack profile-form">
            <h2>Мой профиль</h2>
            <label>
              Ник
              <input key={profile?.id} name="displayName" defaultValue={profile?.display_name || "Amiran"} required />
            </label>
            <button className="ghost-button" type="submit">
              Сохранить ник
            </button>
            <div className="telegram-card">
              <div>
                <strong>Telegram</strong>
                <span>
                  {profile?.telegram_username
                    ? `@${profile.telegram_username}`
                    : profile?.telegram_id
                      ? "Привязан"
                      : "Можно привязать для быстрого входа"}
                </span>
              </div>
              <TelegramLoginButton
                compact
                session={session}
                onLinked={() => {
                  setFormMessage("Telegram привязан к аккаунту.");
                  loadProfile();
                }}
                onMessage={setFormMessage}
              />
            </div>
          </form>

          {canManageGames && (
            <>
              <form onSubmit={addGame} className="stack">
                <h2>Добавить игру</h2>
                <label>
                  Название
                  <input name="title" placeholder="Например: Каркассон" required />
                </label>
                <label>
                  Описание
                  <textarea name="description" rows={3} placeholder="Коротко о стиле игры" />
                </label>
                <label>
                  Обложка
                  <input name="cover" type="file" accept="image/*" />
                </label>
                <button className="primary-button" type="submit">
                  Добавить игру
                </button>
              </form>

              <form onSubmit={updateGame} className="stack">
                <h2>Изменить выбранную игру</h2>
                <label>
                  Название
                  <input key={selectedGame?.id} name="editTitle" defaultValue={selectedGame?.title || ""} required />
                </label>
                <label>
                  Описание
                  <textarea
                    key={`${selectedGame?.id}-description`}
                    name="editDescription"
                    rows={3}
                    defaultValue={selectedGame?.description || ""}
                  />
                </label>
                <label>
                  Новая обложка
                  <input name="editCover" type="file" accept="image/*" />
                </label>
                <button className="primary-button" type="submit">
                  Сохранить изменения
                </button>
                <button className="danger-button" type="button" onClick={deleteSelectedGame} disabled={!selectedGame}>
                  Удалить игру
                </button>
              </form>
            </>
          )}

          {formMessage && <p className="form-message">{formMessage}</p>}
        </aside>

        <section className="main-panel">
          <div className="tabs">
            <button className={`tab ${view === "rating" ? "active" : ""}`} onClick={() => setView("rating")} type="button">
              Рейтинг
            </button>
            <button className={`tab ${view === "details" ? "active" : ""}`} onClick={() => setView("details")} type="button">
              Оценки друзей
            </button>
          </div>

          {view === "rating" ? (
            <section className="view active">
              <div className="section-heading">
                <h2>Общий рейтинг игр</h2>
                <p>В среднем рейтинге учитываются только оценки друзей. Твоё мнение показывается отдельно.</p>
              </div>
              <div className="ranking-list">
                {sortedGames.map((game, index) => (
                  <div className="ranking-item" key={game.id}>
                    <GameCard
                      game={game}
                    rank={index + 1}
                    selected={game.id === selectedGame?.id}
                    userReviewed={session.user ? Boolean(getUserReview(game, session.user.id)) : false}
                    descriptionExpanded={expandedDescriptionId === game.id}
                    onToggleDescription={() =>
                      setExpandedDescriptionId((current) => (current === game.id ? "" : game.id))
                    }
                    onSelect={() => setSelectedGameId(game.id)}
                  />
                    {game.id === selectedGame?.id && (
                      <RatingComments
                        game={game}
                        selectedReview={mySelectedReview}
                        reviewFormLooksOwner={reviewFormLooksOwner}
                        reviewFun={reviewFun}
                        reviewDifficulty={reviewDifficulty}
                        setReviewFun={setReviewFun}
                        setReviewDifficulty={setReviewDifficulty}
                        onSubmit={addReview}
                      />
                    )}
                  </div>
                ))}
                {!games.length && <div className="empty-state">Пока нет игр. Сначала добавь игру, а потом друзья смогут её оценить.</div>}
              </div>
            </section>
          ) : (
            <section className="view active">
              <div className="section-heading split">
                <div>
                  <h2>Кто какие оценки поставил</h2>
                  <p>Выбери игру и смотри все мнения отдельно.</p>
                </div>
              </div>
              <GamePicker
                games={games}
                selectedGameId={selectedGame?.id || ""}
                currentUserId={session.user.id}
                onSelect={setSelectedGameId}
              />
              {!games.length && <div className="empty-state">Пока нет игр. Когда появится первая игра, здесь будут оценки друзей.</div>}
            </section>
          )}
        </section>
      </section>
    </main>
  );
}

function TelegramLoginButton({
  compact = false,
  session,
  onLinked,
  onMessage,
}: {
  compact?: boolean;
  session: Session | null;
  onLinked?: () => void;
  onMessage: (message: string) => void;
}) {
  const [token, setToken] = useState("");
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!token || !waiting) return;

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      const response = await fetch(`/api/telegram-start?token=${encodeURIComponent(token)}`);
      const result = await response.json();

      if (result.status === "pending" && attempts < 120) return;

      window.clearInterval(timer);
      setWaiting(false);
      setToken("");

      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      if (result.status === "linked") {
        onLinked?.();
        return;
      }

      onMessage(result.error || "Telegram не подтвердил вход. Попробуй еще раз.");
    }, 2000);

    return () => window.clearInterval(timer);
  }, [onLinked, onMessage, token, waiting]);

  async function startTelegramLogin() {
    onMessage("");
    setWaiting(true);

    const response = await fetch("/api/telegram-start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ mode: session?.access_token ? "link" : "signin" }),
    });

    const result = await response.json();
    if (!response.ok) {
      setWaiting(false);
      onMessage(result.error || "Telegram-вход пока не удалось начать.");
      return;
    }

    setToken(result.token);
    onMessage("Открой Telegram, нажми Start у бота, потом вернись сюда. Сайт сам продолжит.");

    const opened = window.open(result.botUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = result.botUrl;
    }
  }

  if (!telegramBotUsername) {
    return <p className="telegram-note">Telegram-вход появится после настройки бота.</p>;
  }

  return (
    <button
      className={`telegram-login-button ${compact ? "compact" : ""}`}
      type="button"
      onClick={startTelegramLogin}
      disabled={waiting}
    >
      {waiting ? "Жду Telegram..." : compact ? "Привязать Telegram" : "Войти через Telegram"}
    </button>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div className="summary-tile">
      <span>{value}</span>
      <p>{label}</p>
    </div>
  );
}

function GamePicker({
  games,
  selectedGameId,
  currentUserId,
  onSelect,
}: {
  games: Game[];
  selectedGameId: string;
  currentUserId: string;
  onSelect: (gameId: string) => void;
}) {
  if (!games.length) {
    return null;
  }

  return (
    <div className="game-picker" aria-label="Выбор игры">
      {games.map((game) => (
        <div className="game-picker-item" key={game.id}>
          <button
            className={`game-picker-button ${game.id === selectedGameId ? "selected" : ""}`}
            type="button"
            onClick={() => onSelect(game.id)}
          >
            <GameThumb game={game} />
            <span>
              {game.title}
              {getUserReview(game, currentUserId) && <small>Ты уже оценил</small>}
            </span>
          </button>
          {game.id === selectedGameId && <ReviewDetails game={game} compact />}
        </div>
      ))}
    </div>
  );
}

function GameCard({
  game,
  rank,
  selected,
  userReviewed,
  descriptionExpanded,
  onToggleDescription,
  onSelect,
}: {
  game: Game;
  rank: number;
  selected: boolean;
  userReviewed: boolean;
  descriptionExpanded: boolean;
  onToggleDescription: () => void;
  onSelect: () => void;
}) {
  const friendReviews = publicReviews(game);
  const ownerReview = getOwnerReview(game);
  const funAverage = average(friendReviews, "fun");
  const difficultyAverage = average(friendReviews, "difficulty");
  const description = game.description || "Описание пока не добавлено.";
  const canExpandDescription = description.length > 120;

  return (
    <article
      className={`game-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="rank-badge">{rank}</div>
      <Cover game={game} />
      <div className="game-copy">
        <h3>{game.title}</h3>
        <p className={descriptionExpanded ? "expanded" : ""}>{description}</p>
        {canExpandDescription && (
          <button
            className="description-toggle"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleDescription();
            }}
          >
            {descriptionExpanded ? "Свернуть описание" : "Показать полностью"}
          </button>
        )}
        <span className="review-count">{friendReviews.length} оценок друзей</span>
        {userReviewed && <span className="reviewed-mark">Ты уже оценил</span>}
        {ownerReview && <span className="owner-mark">Есть мнение Амирана</span>}
      </div>
      <div className="score-grid">
        <Score label="Популярность" value={funAverage} />
        <Score label="Сложность" value={difficultyAverage} difficulty />
      </div>
    </article>
  );
}

function ReviewDetails({ game, compact = false }: { game: Game; compact?: boolean }) {
  const ownerReview = getOwnerReview(game);
  const friendReviews = publicReviews(game);

  return (
    <div className={`review-details ${compact ? "compact" : ""}`}>
      {!compact && (
        <article className="selected-game-summary">
          <Cover game={game} />
          <div>
            <h3>{game.title}</h3>
            <p>{game.description || "Описание пока не добавлено."}</p>
          </div>
        </article>
      )}

      {ownerReview && <ReviewRow game={game} review={ownerReview} owner />}

      {friendReviews.map((review) => (
        <ReviewRow game={game} review={review} key={review.id} />
      ))}

      {!ownerReview && !friendReviews.length && (
        <div className="empty-state">У этой игры пока нет оценок. Можно выбрать её в рейтинге и оставить первое мнение.</div>
      )}
    </div>
  );
}

function RatingComments({
  game,
  selectedReview,
  reviewFormLooksOwner,
  reviewFun,
  reviewDifficulty,
  setReviewFun,
  setReviewDifficulty,
  onSubmit,
}: {
  game: Game;
  selectedReview: Review | null;
  reviewFormLooksOwner: boolean;
  reviewFun: number;
  reviewDifficulty: number;
  setReviewFun: (value: number) => void;
  setReviewDifficulty: (value: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const comments = publicReviews(game).filter((review) => (review.comment || "").trim());

  return (
    <section className="rating-comments">
      <ReviewEditor
        game={game}
        selectedReview={selectedReview}
        reviewFormLooksOwner={reviewFormLooksOwner}
        reviewFun={reviewFun}
        reviewDifficulty={reviewDifficulty}
        setReviewFun={setReviewFun}
        setReviewDifficulty={setReviewDifficulty}
        onSubmit={onSubmit}
      />

      <div className="rating-comments-header">
        <div>
          <span>Комментарии друзей</span>
          <h3>{game.title}</h3>
        </div>
        <strong>{comments.length}</strong>
      </div>

      {comments.length ? (
        <div className="comment-list">
          {comments.map((review) => (
            <article className="comment-card" key={review.id}>
              <div>
                <strong>{displayReviewer(review)}</strong>
                <p>{review.comment || ""}</p>
              </div>
              <div className="comment-scores">
                <span>Понравилось {review.fun}/10</span>
                <span>Сложность {review.difficulty}/10</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">Пока нет комментариев друзей. Оставь первый комментарий после оценки.</div>
      )}
    </section>
  );
}

function ReviewEditor({
  game,
  selectedReview,
  reviewFormLooksOwner,
  reviewFun,
  reviewDifficulty,
  setReviewFun,
  setReviewDifficulty,
  onSubmit,
}: {
  game: Game;
  selectedReview: Review | null;
  reviewFormLooksOwner: boolean;
  reviewFun: number;
  reviewDifficulty: number;
  setReviewFun: (value: number) => void;
  setReviewDifficulty: (value: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      key={`${game.id}-${selectedReview?.id || "new"}`}
      onSubmit={onSubmit}
      className={`inline-review-form ${reviewFormLooksOwner ? "owner-review-form" : ""}`}
    >
      <div className="inline-review-heading">
        <div>
          <span>{game.title}</span>
          <h3>
            {reviewFormLooksOwner
              ? selectedReview
                ? "Изменить мнение Амирана"
                : "Мнение Амирана"
              : selectedReview
                ? "Изменить оценку"
                : "Добавить оценку"}
          </h3>
        </div>
        <button className="primary-button" type="submit">
          {selectedReview ? "Обновить" : reviewFormLooksOwner ? "Сохранить мнение" : "Сохранить оценку"}
        </button>
      </div>

      <div className="inline-review-grid">
        <label>
          <span className="slider-label">
            Насколько понравилось
            <strong>{reviewFun}/10</strong>
          </span>
          <input
            name="fun"
            type="range"
            min="1"
            max="10"
            value={reviewFun}
            onChange={(event) => setReviewFun(Number(event.target.value))}
          />
        </label>
        <label>
          <span className="slider-label">
            Сложность
            <strong>{reviewDifficulty}/10</strong>
          </span>
          <input
            name="difficulty"
            type="range"
            min="1"
            max="10"
            value={reviewDifficulty}
            onChange={(event) => setReviewDifficulty(Number(event.target.value))}
          />
        </label>
      </div>

      <label>
        Комментарий
        <textarea
          name="comment"
          rows={3}
          placeholder="Что понравилось или было сложно"
          defaultValue={selectedReview?.comment || ""}
        />
      </label>
    </form>
  );
}

function ReviewRow({ game, review, owner = false }: { game: Game; review: Review; owner?: boolean }) {
  return (
    <div className={`review-row ${owner ? "owner-review" : ""}`}>
      <div>
        <strong>{owner ? "Мнение Амирана" : displayReviewer(review)}</strong>
        <span>{game.title}</span>
        <p className={`review-comment ${review.comment ? "" : "muted-comment"}`}>
          {review.comment || "Без комментария"}
        </p>
      </div>
      <div className="pill">Понравилось: {review.fun}/10</div>
      <div className="pill">Сложность: {review.difficulty}/10</div>
    </div>
  );
}

function Cover({ game }: { game: Game }) {
  if (game.cover_url) {
    return <img className="game-cover" src={game.cover_url} alt={`Обложка ${game.title}`} />;
  }

  return <div className="game-cover cover-placeholder">{initials(game.title)}</div>;
}

function GameThumb({ game }: { game: Game }) {
  if (game.cover_url) {
    return <img className="game-picker-cover" src={game.cover_url} alt={`Обложка ${game.title}`} />;
  }

  return <div className="game-picker-cover game-picker-placeholder">{initials(game.title)}</div>;
}

function Score({ label, value, difficulty = false }: { label: string; value: number; difficulty?: boolean }) {
  const text = value ? value.toFixed(1) : "нет";

  return (
    <div className={`score-block ${difficulty ? "difficulty-score" : ""}`}>
      <span>{label}</span>
      <strong>{text}</strong>
      <div className="meter">
        <span style={{ width: `${Math.min(100, value * 10)}%` }} />
      </div>
    </div>
  );
}

function publicReviews(game: Game) {
  return game.reviews.filter((review) => !review.is_owner_review);
}

function getOwnerReview(game: Game) {
  return game.reviews.find((review) => review.is_owner_review);
}

function ownerTieScore(game: Game) {
  return getOwnerReview(game)?.fun || 0;
}

function getUserReview(game: Game, userId: string) {
  return game.reviews.find((review) => review.user_id === userId) || null;
}

function displayReviewer(review: Review) {
  const reviewerProfile = getReviewProfile(review.profiles);
  return reviewerProfile?.display_name || review.friend_name || reviewerProfile?.email?.split("@")[0] || "Друг";
}

function getReviewProfile(profile: Review["profiles"]): ReviewProfile | null {
  if (Array.isArray(profile)) {
    return profile[0] || null;
  }

  return profile || null;
}

function average(reviews: Review[], field: "fun" | "difficulty") {
  if (!reviews.length) return 0;
  return total(reviews, field) / reviews.length;
}

function total(reviews: Review[], field: "fun" | "difficulty") {
  return reviews.reduce((sum, review) => sum + review[field], 0);
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function resizeCover(file: File) {
  return new Promise<Blob>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 1080;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Canvas is not available"));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const x = (size - width) / 2;
        const y = (size - height) / 2;
        context.drawImage(image, x, y, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Cover conversion failed"));
        }, "image/jpeg", 0.9);
      };
      image.onerror = reject;
      image.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
