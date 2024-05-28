<p align="center">
  <a href="https://wordleteams.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/wt-icon-144x144.png">
      <img src="./public/wt-icon-144x144.png" height="128">
    </picture>
    <h1 align="center">Wordle Teams</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Join the community on GitHub" href="https://github.com/cdub615/wordle-teams/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-indigo.svg?style=social&labelColor=000000&logo=github&logoWidth=20">
  </a>
  <a aria-label="Changelog" href="https://feedback.wordleteams.com/changelog">
    <img alt="" src="https://img.shields.io/badge/Changelog-blueviolet.svg">
  </a>
</p>


Wordle Teams is an open-source multiplayer version of the popular word-guessing game Wordle, built with Next.js, Supabase, and shadcn/ui. This project is designed to bring the fun of Wordle to teams and groups, allowing players to collaborate and compete in a shared game experience.

## Features

- **Team Creation**: Create and join teams to play Wordle together.
- **Score Tracking**: Enter your Wordle boards and track scores each month with scores applied by number of attempts.
- **View Completed Boards**: See your friends' completed boards to see how they got to the answer.
- **User Authentication**: Secure login and registration system powered by Supabase.
- **Responsive Design**: Optimized for seamless use across various devices.

## Technologies Used

- **Next.js**: A React framework for building server-side rendered and static web applications.
- **Supabase**: An open-source Firebase alternative for backend services, including authentication, database, and storage.
- **shadcn/ui**: A set of accessible and customizable React UI components for building modern user interfaces.
- **Lemon Squeezy**: A payment processing system for handling in-app purchases and subscriptions.

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/cdub615/wordle-teams.git
```

2. Navigate to the project directory:

```bash
cd wordle-teams
```

3. Install dependencies:

```bash
npm install
```

4. Create a `.env.local` file in the root directory and add the following variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
EDGE_CONFIG=your-vercel-edge-config-url
LOGSNAG_TOKEN=your-logsnag-token
LEMONSQUEEZY_API_KEY=your-lemonsqueezy-api-key
LEMONSQUEEZY_STORE_ID=your-lemonsqueezy-store-id
LEMONSQUEEZY_WEBHOOK_SECRET=your-lemonsqueezy-webhook-secret
```

5. Start the development server:

```bash
npm run dev
```

6. Open your browser and navigate to `http://localhost:3000` to see the application running.


### Contributing

We welcome contributions from the community! If you'd like to contribute to Wordle Teams, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them with descriptive commit messages.
4. Push your changes to your forked repository.
5. Submit a pull request to the main repository, describing your changes in detail.

Please ensure that your code follows the project's coding conventions and adheres to best practices.

### License

This project is licensed under the MIT License.

### Acknowledgments

- Next.js
- Supabase
- shadcn/ui
- Lemon Squeezy
- Wordle (the original game that inspired this project)