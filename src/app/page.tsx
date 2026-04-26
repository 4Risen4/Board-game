"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Game, Profile, Review, ReviewProfile, supabase } from "@/lib/supabase";

type View = "rating" | "details";
type AuthMode = "signin" | "signup";

const bucketName = "covers";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [view, setView] = useState<View>("rating");
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [selectedGameId, setSelectedGameId] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0];
  const isOwner = profile?.role === "owner";

  const sortedGames = useMemo(() => {
    return [...games].sort((first, second) => total(publicReviews(second), "fun") - total(publicReviews(first), "fun"));
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

  async function loadProfile() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,role")
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

  async function addGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner) return;

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
    if (!isOwner || !selectedGame) return;

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
    if (!isOwner || !selectedGame) return;
    const confirmed = window.confirm(`Удалить игру "${selectedGame.title}" вместе со всеми оценками?`);
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

    const { error } = await supabase.from("reviews").insert({
      game_id: selectedGame.id,
      user_id: session.user.id,
      friend_name: reviewerName,
      fun,
      difficulty,
      comment,
      is_owner_review: isOwner,
    });

    if (error) {
      setFormMessage(error.code === "23505" ? "Ты уже оставил оценку для этой игры." : error.message);
      return;
    }

    event.currentTarget.reset();
    setFormMessage(isOwner ? "Твоё мнение владельца сохранено отдельно." : "Оценка сохранена.");
    loadGames();
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
          <button className="ghost-button" type="button" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <Summary value={games.length} label="игр" />
        <Summary value={reviewsCount} label="оценок друзей" />
        <Summary value={friendsCount} label="друзей" />
      </section>

      <section className="workspace">
        <aside className="panel input-panel">
          {isOwner && (
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

          <form onSubmit={addReview} className={`stack ${isOwner ? "owner-review-form" : ""}`}>
            <h2>{isOwner ? "Моя личная оценка" : "Добавить оценку"}</h2>
            <label>
              Игра
              <select value={selectedGameId} onChange={(event) => setSelectedGameId(event.target.value)}>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Насколько понравилось
              <input name="fun" type="range" min="1" max="10" defaultValue="8" />
            </label>
            <label>
              Сложность
              <input name="difficulty" type="range" min="1" max="10" defaultValue="5" />
            </label>
            <label>
              Комментарий
              <textarea name="comment" rows={3} placeholder="Что понравилось или было сложно" />
            </label>
            <button className="primary-button" type="submit" disabled={!selectedGame}>
              {isOwner ? "Сохранить моё мнение" : "Сохранить оценку"}
            </button>
          </form>

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
                  <GameCard
                    key={game.id}
                    game={game}
                    rank={index + 1}
                    selected={game.id === selectedGame?.id}
                    onSelect={() => setSelectedGameId(game.id)}
                  />
                ))}
                {!games.length && <div className="empty-state">Пока нет игр.</div>}
              </div>
            </section>
          ) : (
            <section className="view active">
              <div className="section-heading split">
                <div>
                  <h2>Кто какие оценки поставил</h2>
                  <p>Выбери игру и смотри все мнения отдельно.</p>
                </div>
                <select value={selectedGame?.id || ""} onChange={(event) => setSelectedGameId(event.target.value)}>
                  {games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.title}
                    </option>
                  ))}
                </select>
              </div>
              {selectedGame ? <ReviewDetails game={selectedGame} /> : <div className="empty-state">Пока нет игр.</div>}
            </section>
          )}
        </section>
      </section>
    </main>
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

function GameCard({
  game,
  rank,
  selected,
  onSelect,
}: {
  game: Game;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const friendReviews = publicReviews(game);
  const ownerReview = getOwnerReview(game);
  const funAverage = average(friendReviews, "fun");
  const difficultyAverage = average(friendReviews, "difficulty");

  return (
    <button className={`game-card ${selected ? "selected" : ""}`} type="button" onClick={onSelect}>
      <div className="rank-badge">{rank}</div>
      <Cover game={game} />
      <div className="game-copy">
        <h3>{game.title}</h3>
        <p>{game.description || "Описание пока не добавлено."}</p>
        <span className="review-count">{friendReviews.length} оценок друзей</span>
        {ownerReview && <span className="owner-mark">Есть мнение владельца</span>}
      </div>
      <div className="score-grid">
        <Score label="Популярность" value={funAverage} />
        <Score label="Сложность" value={difficultyAverage} difficulty />
      </div>
    </button>
  );
}

function ReviewDetails({ game }: { game: Game }) {
  const ownerReview = getOwnerReview(game);
  const friendReviews = publicReviews(game);

  return (
    <div className="review-details">
      <article className="selected-game-summary">
        <Cover game={game} />
        <div>
          <h3>{game.title}</h3>
          <p>{game.description || "Описание пока не добавлено."}</p>
        </div>
      </article>

      {ownerReview && <ReviewRow game={game} review={ownerReview} owner />}

      {friendReviews.map((review) => (
        <ReviewRow game={game} review={review} key={review.id} />
      ))}

      {!ownerReview && !friendReviews.length && <div className="empty-state">У этой игры пока нет оценок.</div>}
    </div>
  );
}

function ReviewRow({ game, review, owner = false }: { game: Game; review: Review; owner?: boolean }) {
  return (
    <div className={`review-row ${owner ? "owner-review" : ""}`}>
      <div>
        <strong>{owner ? "Моё мнение владельца" : displayReviewer(review)}</strong>
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
