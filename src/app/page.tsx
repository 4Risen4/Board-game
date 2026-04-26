"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Game, Profile, Review, supabase } from "@/lib/supabase";

type View = "rating" | "details";

const bucketName = "covers";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [view, setView] = useState<View>("rating");
  const [selectedGameId, setSelectedGameId] = useState("");
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0];
  const isOwner = profile?.role === "owner";

  const sortedGames = useMemo(() => {
    return [...games].sort((first, second) => total(second.reviews, "fun") - total(first.reviews, "fun"));
  }, [games]);

  const friendsCount = useMemo(() => {
    return new Set(games.flatMap((game) => game.reviews.map((review) => review.user_id))).size;
  }, [games]);

  const reviewsCount = useMemo(() => {
    return games.reduce((count, game) => count + game.reviews.length, 0);
  }, [games]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
      .select("id,title,description,cover_url,created_at,reviews(id,game_id,user_id,friend_name,fun,difficulty,comment,created_at)")
      .order("created_at", { ascending: false });

    if (error) {
      setFormMessage(error.message);
      return;
    }

    const loadedGames = (data || []) as Game[];
    setGames(loadedGames);
    setSelectedGameId((current) => current || loadedGames[0]?.id || "");
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setAuthMessage(error ? error.message : "Проверь почту: Supabase отправил ссылку для входа.");
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

  async function addReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user || !selectedGame) return;

    const form = new FormData(event.currentTarget);
    const friendName = String(form.get("friendName") || "").trim();
    const fun = Number(form.get("fun") || 8);
    const difficulty = Number(form.get("difficulty") || 5);
    const comment = String(form.get("comment") || "").trim();

    if (!friendName) return;

    const { error } = await supabase.from("reviews").insert({
      game_id: selectedGame.id,
      user_id: session.user.id,
      friend_name: friendName,
      fun,
      difficulty,
      comment,
    });

    if (error) {
      setFormMessage(error.code === "23505" ? "Ты уже оценил эту игру." : error.message);
      return;
    }

    event.currentTarget.reset();
    setFormMessage("Оценка сохранена.");
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
          <form onSubmit={signIn} className="stack">
            <label>
              E-mail
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
            <button className="primary-button" type="submit">
              Войти по e-mail
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
          <span>{profile?.email || session.user.email}</span>
          <button className="ghost-button" type="button" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <Summary value={games.length} label="игр" />
        <Summary value={reviewsCount} label="оценок" />
        <Summary value={friendsCount} label="друзей" />
      </section>

      <section className="workspace">
        <aside className="panel input-panel">
          {isOwner ? (
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
              </form>
            </>
          ) : (
            <form onSubmit={addReview} className="stack">
              <h2>Добавить оценку</h2>
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
                Твоё имя
                <input name="friendName" placeholder="Имя друга" defaultValue={profile?.display_name || ""} required />
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
              <button className="primary-button" type="submit">
                Сохранить оценку
              </button>
            </form>
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
                <p>В каждой игре видно среднюю популярность и среднюю сложность.</p>
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
  const funAverage = average(game.reviews, "fun");
  const difficultyAverage = average(game.reviews, "difficulty");

  return (
    <button className={`game-card ${selected ? "selected" : ""}`} type="button" onClick={onSelect}>
      <div className="rank-badge">{rank}</div>
      <Cover game={game} />
      <div className="game-copy">
        <h3>{game.title}</h3>
        <p>{game.description || "Описание пока не добавлено."}</p>
        <span className="review-count">{game.reviews.length} оценок</span>
      </div>
      <div className="score-grid">
        <Score label="Популярность" value={funAverage} />
        <Score label="Сложность" value={difficultyAverage} difficulty />
      </div>
    </button>
  );
}

function ReviewDetails({ game }: { game: Game }) {
  return (
    <div className="review-details">
      <article className="selected-game-summary">
        <Cover game={game} />
        <div>
          <h3>{game.title}</h3>
          <p>{game.description || "Описание пока не добавлено."}</p>
        </div>
      </article>
      {game.reviews.map((review) => (
        <div className="review-row" key={review.id}>
          <div>
            <strong>{review.friend_name}</strong>
            <span>{game.title}</span>
            <p className={`review-comment ${review.comment ? "" : "muted-comment"}`}>
              {review.comment || "Без комментария"}
            </p>
          </div>
          <div className="pill">Понравилось: {review.fun}/10</div>
          <div className="pill">Сложность: {review.difficulty}/10</div>
        </div>
      ))}
      {!game.reviews.length && <div className="empty-state">У этой игры пока нет оценок.</div>}
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
