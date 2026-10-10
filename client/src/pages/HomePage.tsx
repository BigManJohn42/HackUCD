const CARDS = [
  {
    href: "#/journey",
    number: "01",
    title: "Journey Planner",
    text: "Type where you're going. Every step of the journey is yours to edit - swap the mode, add a break, see it on the map.",
  },
  {
    href: "#/subscriptions",
    number: "02",
    title: "Go further with Pro",
    text: "Unlimited saved itineraries and richer break recommendations for a couple of euro a month.",
  },
];

export function HomePage() {
  return (
    <section>
      <div className="hero">
        <span className="eyebrow">A little clarity for your everyday journey</span>
        <h1>
          Plan your commute,
          <br />
          <em>one clear step at a time.</em>
        </h1>
        <p>
          Real Dublin stops and timetables, a journey you can edit leg by leg, and an AI
          concierge that tells you what to do with a break between transfers.
        </p>
      </div>
      <div className="home-grid">
        {CARDS.map((card) => (
          <a className="home-card" href={card.href} key={card.href}>
            <span className="card-number">{card.number}</span>
            <h2>{card.title}</h2>
            <p>{card.text}</p>
            <span className="card-action">
              Open <span aria-hidden="true">&rarr;</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
