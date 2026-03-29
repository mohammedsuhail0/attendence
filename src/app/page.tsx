const featuredPrograms = [
  {
    title: 'Qur\'an & Hifz Pathway',
    description:
      'Daily tajwid, memorization circles, and reflection sessions led with patience and consistency.',
  },
  {
    title: 'STEM & Inquiry Labs',
    description:
      'Hands-on science, coding, and mathematics projects that build confidence in real-world problem solving.',
  },
  {
    title: 'Arabic & Global Communication',
    description:
      'Arabic foundations alongside fluent English expression, public speaking, and thoughtful writing.',
  },
];

const values = [
  'Akhlaq-centered classrooms rooted in adab, discipline, and compassion.',
  'Strong academic preparation for university, careers, and civic contribution.',
  'Safe mentoring culture with close teacher-family partnership.',
  'Balanced development through sports, service, leadership, and creativity.',
];

const milestones = [
  'Early Years: joyful routines, phonics, numeracy, duas, and social confidence.',
  'Primary School: strong literacy, Qur\'an fluency, inquiry-based learning, and teamwork.',
  'Secondary School: exam readiness, leadership projects, research, and service-based tarbiyah.',
];

export default function Home() {
  return (
    <main className="school-home">
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">Al-Noor Academy</span>
          <h1>Where Islamic character and academic excellence grow together.</h1>
          <p className="hero-lead">
            A modern school experience shaped by Qur&apos;anic values, rigorous academics,
            and a warm community that prepares students for this dunya and the akhirah.
          </p>

          <div className="hero-actions">
            <a className="btn btn-primary" href="/login">
              Enter School Portal
            </a>
            <a className="btn btn-outline" href="#programs">
              Explore Programs
            </a>
          </div>

          <div className="hero-stats">
            <div className="stat-card">
              <strong>Dual Curriculum</strong>
              <span>Islamic studies woven into every stage of learning</span>
            </div>
            <div className="stat-card">
              <strong>Small Class Culture</strong>
              <span>Close mentoring, strong adab, and personal attention</span>
            </div>
            <div className="stat-card">
              <strong>Future Ready</strong>
              <span>STEM, communication, leadership, and service learning</span>
            </div>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-top">
            <span>Today at Al-Noor</span>
            <span>Faith. Knowledge. Service.</span>
          </div>

          <div className="prayer-card">
            <p>Morning Rhythm</p>
            <h2>Assembly, Qur&apos;an, then deep learning blocks.</h2>
            <span>
              Students begin with remembrance, intention, and a calm structure for the day.
            </span>
          </div>

          <div className="panel-grid">
            <article>
              <h3>Islamic Studies</h3>
              <p>Aqidah, fiqh, seerah, tajwid, and adab taught with clarity and love.</p>
            </article>
            <article>
              <h3>Academic Rigor</h3>
              <p>English, mathematics, science, humanities, and technology with high standards.</p>
            </article>
            <article>
              <h3>Student Life</h3>
              <p>Clubs, sports, competitions, charity drives, and leadership opportunities.</p>
            </article>
            <article>
              <h3>Family Partnership</h3>
              <p>Regular reporting, open communication, and shared tarbiyah goals.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="school-section" id="programs">
        <div className="section-heading">
          <span className="eyebrow">Our Learning Model</span>
          <h2>One campus, two strengths, one clear purpose.</h2>
          <p>
            We refuse the false choice between religious depth and academic ambition.
            Our students are taught to think deeply, worship sincerely, and contribute wisely.
          </p>
        </div>

        <div className="program-grid">
          {featuredPrograms.map((program) => (
            <article className="feature-card" key={program.title}>
              <h3>{program.title}</h3>
              <p>{program.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="school-section split-section">
        <div className="split-card accent-card">
          <span className="eyebrow">Why Families Choose Us</span>
          <h2>A school culture built on ihsan.</h2>
          <div className="check-list">
            {values.map((value) => (
              <p key={value}>{value}</p>
            ))}
          </div>
        </div>

        <div className="split-card">
          <span className="eyebrow">Student Journey</span>
          <h2>Clear formation from early years to graduation.</h2>
          <div className="journey-list">
            {milestones.map((item) => (
              <article key={item}>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="school-section testimonial-section">
        <div className="section-heading">
          <span className="eyebrow">Campus Life</span>
          <h2>Students learn with their minds, hearts, and hands.</h2>
        </div>

        <div className="campus-grid">
          <article className="campus-card">
            <h3>Weekly Khutbah & Reflection</h3>
            <p>
              Age-appropriate reminders help students connect faith to daily decisions, friendships,
              and responsibilities.
            </p>
          </article>
          <article className="campus-card">
            <h3>Project-Based Classrooms</h3>
            <p>
              Students build, present, debate, and investigate so learning feels alive and memorable.
            </p>
          </article>
          <article className="campus-card">
            <h3>Service & Leadership</h3>
            <p>
              Community outreach, peer mentoring, and school leadership roles develop purpose and maturity.
            </p>
          </article>
        </div>

        <blockquote className="testimonial-quote">
          “We wanted a school that would protect our children&apos;s identity without limiting their future.
          Al-Noor gave us both.”
          <cite>Parent of Year 7 student</cite>
        </blockquote>
      </section>

      <section className="school-section cta-section">
        <span className="eyebrow">Admissions & Portal</span>
        <h2>Build a generation grounded in revelation and ready for the world.</h2>
        <p>
          Explore the school portal, connect with staff, and take the first step toward a more balanced education.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/login">
            Sign In
          </a>
          <a className="btn btn-outline" href="mailto:admissions@alnooracademy.edu">
            Contact Admissions
          </a>
        </div>
      </section>
    </main>
  );
}
